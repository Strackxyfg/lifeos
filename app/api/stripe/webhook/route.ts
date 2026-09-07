import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

// Stripe signature verification needs the raw body → Node runtime.
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: `Webhook Error: ${msg}` }, { status: 400 });
  }

  try {
    const db = createAdminClient();
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        await db.from("subscriptions").upsert({
          user_id: s.client_reference_id,
          stripe_customer_id: s.customer as string,
          stripe_subscription_id: s.subscription as string,
          plan: s.metadata?.plan ?? "pro",
          status: "trialing",
        });
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await db
          .from("subscriptions")
          .update({ status: sub.status, current_period_end: new Date(sub.current_period_end * 1000).toISOString() })
          .eq("stripe_subscription_id", sub.id);
        break;
      }
      default:
        // Unhandled event types are acknowledged, not errored.
        break;
    }
  } catch (err) {
    console.error("Webhook handler failed", err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
