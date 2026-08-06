import { loadStripe, Stripe } from '@stripe/stripe-js';

let stripePromise: Promise<Stripe | null>;

export function getStripe() {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_FINGER_CHESS_STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey || publishableKey === 'pk_test_xxx' || publishableKey.includes('change_me')) {
      throw new Error(
        'NEXT_PUBLIC_FINGER_CHESS_STRIPE_PUBLISHABLE_KEY must be configured with a real Stripe publishable key',
      );
    }
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}
