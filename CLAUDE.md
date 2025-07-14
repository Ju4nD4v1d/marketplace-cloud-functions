# Firebase Cloud Functions Marketplace

This project contains Firebase Cloud Functions for a marketplace application with Stripe payment integration and revenue analytics.

## Project Structure

- **functions/src/index.ts**: Main cloud functions implementation
- **firebase.json**: Firebase project configuration with emulator settings
- **functions/package.json**: Dependencies and build scripts

## Cloud Functions

### scheduledMonthlyRevenueCalculation
- **Type**: Scheduled function (daily at 2 AM PT)
- **Purpose**: Calculates and stores monthly revenue analytics with weekly breakdowns
- **Collections Used**: 
  - `orders` (source data)
  - `monthlyRevenueSummary` (output analytics)
- **Metrics Calculated**: revenue, orders, products sold, active customers (monthly + weekly)

### handlePaymentWebhook
- **Type**: HTTP function (public endpoint)
- **Purpose**: Handles Stripe webhook events for payment processing
- **Events Handled**: `payment_intent.succeeded`
- **Security**: Uses Stripe webhook signature verification
- **Secrets Required**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

## Development Commands

```bash
# Build TypeScript
npm run build

# Start Firebase emulators
npm run serve

# Deploy functions
npm run deploy

# Lint code
npm run lint

# View logs
npm run logs
```

## Firestore Schema

### orders Collection
- `storeId`: string
- `userId`: string  
- `totalOrderPrice`: number
- `createdDate`: timestamp
- `status`: string (updated to "paid" by webhook)
- `paidAt`: timestamp (set by webhook)

### orders/{orderId}/orderDetails Subcollection
- `quantity`: number

### monthlyRevenueSummary Collection
- `storeId`: string
- `month`: string (YYYY-MM format)
- `totalRevenue`: number
- `totalOrders`: number
- `totalProductsSold`: number
- `activeCustomers`: number
- `weekly`: array of weekly stats
- `updatedAt`: timestamp

## Environment Setup

1. Configure Firebase secrets:
   ```bash
   firebase functions:secrets:set STRIPE_SECRET_KEY
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```

2. Ensure Node.js 22 is installed (specified in package.json engines)

## Testing

Use Firebase emulators for local development:
- Functions: http://localhost:5001
- Firestore: http://localhost:8080  
- Emulator UI: http://localhost:4000