import Stripe from "stripe";

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

export type PlanId = "starter" | "pro" | "founder";

export const PLANS: Record<PlanId, { name: string; price: number; priceEnv: string; workspaces: number; generations: number }> = {
  starter: { name: "Starter", price: 19, priceEnv: "STRIPE_PRICE_STARTER", workspaces: 1, generations: 10 },
  pro: { name: "Pro", price: 49, priceEnv: "STRIPE_PRICE_PRO", workspaces: 3, generations: 50 },
  founder: { name: "Founder", price: 99, priceEnv: "STRIPE_PRICE_FOUNDER", workspaces: 999, generations: 999 },
};

/** Create a Checkout session for a plan. Returns the redirect URL. */
export async function createCheckoutSession(opts: {
  plan: PlanId;
  customerId?: string;
  customerEmail?: string;
  userId: string;
}): Promise<string> {
  const priceId = process.env[PLANS[opts.plan].priceEnv];
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const session = await getStripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: opts.customerId,
    customer_email: opts.customerId ? undefined : opts.customerEmail,
    client_reference_id: opts.userId,
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
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/billing`,
  });
  return session.url;
}
