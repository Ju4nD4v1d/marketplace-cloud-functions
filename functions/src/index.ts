import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import { faker } from "@faker-js/faker";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import Stripe from "stripe";

admin.initializeApp();
const db = admin.firestore();

// Define secrets for v2 functions
const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

// Fixed storeId
const STORE_ID = "MxOFNkEGVNrgaNfTaXlN";

// ▶️ New: list of possible userIds
const userIds = [
  "JFsmiiWMHjgdtHFFdhtqEDPAZsl1",
  "lDfLMVzWYaRscgQ4gea3vqBUc5r2",
  "fEWRpFTXpSgh4H45aAZ7GY9dWer2"
];

/**
 * Calculate monthly + per-week revenue, orders, productsSold, and activeCustomers per store.
 */
async function calculateAndStoreMonthlyRevenue(): Promise<void> {
  const ordersSnapshot = await db.collection("orders").get();

  type WeekStats = { revenue: number; orders: number; productsSold: number; users: Set<string> };
  type MonthStats = {
    revenue: number;
    orders: number;
    productsSold: number;
    weekly: Record<number, WeekStats>;
    userSet: Set<string>;
  };

  const stats: Record<string, MonthStats> = {};

  // Use for...of so we can await inside the loop
  for (const orderDoc of ordersSnapshot.docs) {
    const o = orderDoc.data();
    const storeId = o.storeId as string;
    const userId  = o.userId  as string;
    const price   = o.totalOrderPrice as number;
    if (!storeId || !userId || price == null) continue;

    // normalize date
    const date = typeof o.createdDate?.toDate === "function"
      ? o.createdDate.toDate()
      : new Date(o.createdDate);
    const year  = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const weekOfMonth = Math.ceil(date.getDate() / 7);
    const monthKey = `${year}-${month}`;
    const key = `${storeId}_${monthKey}`;

    // init MonthStats
    if (!stats[key]) {
      stats[key] = {
        revenue: 0,
        orders: 0,
        productsSold: 0,
        weekly: {},
        userSet: new Set(),
      };
    }
    const m = stats[key];

    // fetch and sum quantities from orderDetails
    const itemsSnap = await orderDoc.ref.collection("orderDetails").get();
    const qty = itemsSnap.docs.reduce(
      (sum, d) => sum + (d.data().quantity ?? 0),
      0
    );

    // accumulate monthly totals
    m.revenue       += price;
    m.orders        += 1;
    m.productsSold  += qty;
    m.userSet.add(userId);
1
    // init WeekStats
    if (!m.weekly[weekOfMonth]) {
      m.weekly[weekOfMonth] = {
        revenue: 0,
        orders: 0,
        productsSold: 0,
        users: new Set(),
      };
    }
    const w = m.weekly[weekOfMonth];
    w.revenue       += price;
    w.orders        += 1;
    w.productsSold  += qty;
    w.users.add(userId);
  }

  // batch‐write
  const batch = db.batch();
  for (const [key, m] of Object.entries(stats)) {
    const [storeId, month] = key.split("_");
    const docRef = db.collection("monthlyRevenueSummary").doc(key);

    // turn weekly map into array
    const weeklyArray = Object.entries(m.weekly)
      .map(([wk, ws]) => ({
        week:             Number(wk),
        revenue:          ws.revenue,
        orders:           ws.orders,
        productsSold:     ws.productsSold,
        activeCustomers:  ws.users.size,
      }))
      .sort((a, b) => a.week - b.week);

    batch.set(docRef, {
      storeId,
      month,
      totalRevenue:     m.revenue,
      totalOrders:      m.orders,
      totalProductsSold:m.productsSold,
      activeCustomers:  m.userSet.size,
      weekly:           weeklyArray,
      updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
}


// Scheduled: every day at 2 AM PT
export const scheduledMonthlyRevenueCalculation = onSchedule(
  { schedule: "0 2 * * *", timeZone: "America/Los_Angeles" },
  async () => {
    try {
      await calculateAndStoreMonthlyRevenue();
      logger.info("✅ monthlyRevenueSummary (with weekly breakdown) updated");
    } catch (e) {
      logger.error("❌ revenue calc failed:", e);
    }
  }
);

// Manual trigger for testing
export const testMonthlyRevenue = onRequest(async (_req, res) => {
  try {
    await calculateAndStoreMonthlyRevenue();
    res.status(200).send("Manual revenue calculation completed.");
  } catch (e) {
    console.error("❌ manual calc failed:", e);
    res.status(500).send("Error during revenue calculation.");
  }
});

// Stripe webhook handler
export const handlePaymentWebhook = onRequest(
  {
    invoker: "public",
    cors: true,
    secrets: [stripeSecretKey, stripeWebhookSecret],
  },
  async (req, res) => {
    try {
      const sig = req.headers["stripe-signature"];
      
      // Access secrets securely
      const secretKey = stripeSecretKey.value();
      const webhookSecret = stripeWebhookSecret.value();

      if (!sig || !webhookSecret) {
        logger.error("❌ Missing signature or webhook secret");
        res.status(400).send("Missing signature or webhook secret");
        return;
      }

      // Initialize Stripe inside the function
      const stripe = new Stripe(secretKey);

      const event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        webhookSecret
      );

      // Handle payment_intent.succeeded events
      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = paymentIntent.metadata.orderId;

        if (orderId) {
          await db.collection("orders")
            .doc(orderId)
            .set({
              status: "paid",
              paidAt: admin.firestore.FieldValue.serverTimestamp(),
            }, {merge: true});

          logger.info(`✅ Order ${orderId} marked as paid`);
        }
      }

      res.json({received: true});
    } catch (err) {
      logger.error("❌ Webhook signature verification failed:", err);
      res.status(400).send(`Webhook Error: ${err}`);
    }
  }
);