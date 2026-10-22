import Stripe from "stripe";
import type { Edition } from "@/lib/plans/editions";

/**
 * Lazily-constructed, server-only Stripe client.
 * Lazy so importing this module has no side effects (env may be absent at
 * build time; Stripe v17 throws if constructed without a key).
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  _stripe = new Stripe(key, {
    // Pinned to the version shipped with the installed SDK's types.
    apiVersion: "2025-02-24.acacia",
    typescript: true,
    appInfo: { name: "LifeOS AI", version: "0.1.0" },
  });
  return _stripe;
}

/** The Stripe price of each edition. Prices themselves live in Stripe (and, for display, the dictionary). */
export const PRICE_ENV: Record<Edition, string> = {
  personal: "STRIPE_PRICE_PERSONAL",
  solo: "STRIPE_PRICE_SOLO",
  team: "STRIPE_PRICE_TEAM",
};

/** Create a Checkout session for an edition. Returns the redirect URL. */
export async function createCheckoutSession(opts: {
  plan: Edition;
  customerId?: string;
  customerEmail?: string;
  userId: string;
}): Promise<string> {
  const priceId = process.env[PRICE_ENV[opts.plan]];
  if (!priceId) throw new Error(`${PRICE_ENV[opts.plan]} is not set`);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: opts.customerId,
    customer_email: opts.customerId ? undefined : opts.customerEmail,
    client_reference_id: opts.userId,
    // On the session for the webhook, on the subscription for later events.
    metadata: { plan: opts.plan },
    allow_promotion_codes: true,
    subscription_data: { trial_period_days: 14, metadata: { userId: opts.userId, plan: opts.plan } },
    success_url: `${appUrl}/dashboard?welcome=1`,
    cancel_url: `${appUrl}/billing`,
  });

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Create a Billing Portal session for self-serve management. */
export async function createPortalSession(customerId: string): Promise<string> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/billing`,
  });
  return session.url;
}
