# Stripe Implementation — LifeOS AI

Code: [`../lib/stripe/client.ts`](../lib/stripe/client.ts) ·
webhook [`../app/api/stripe/webhook/route.ts`](../app/api/stripe/webhook/route.ts) ·
mirror table `subscriptions` in [`../supabase/schema.sql`](../supabase/schema.sql).

## Packaging

| Plan | Price | Trial | Included |
|---|---|---|---|
| Starter | $19/mo | 14d | 1 workspace, 10 generations/mo, calendar sync, daily summaries |
| **Pro** (featured) | $49/mo | 14d | + CRM & Finance, weekly reviews, Gmail/Slack/GitHub, voice, 3 workspaces |
| Founder | $99/mo | 14d | + team, custom automations, analytics/KPIs, priority, unlimited |

Annual billing (2 months free) planned. Promotion codes enabled on Checkout.

## Flow

```
/billing → createCheckoutSession(plan)   [server action → Stripe Checkout]
        → Stripe hosted Checkout (subscription, 14-day trial)
        → success_url /dashboard?welcome=1
        → Stripe fires webhooks ─────────► /api/stripe/webhook
                                            verify signature (raw body, node runtime)
                                            mirror → public.subscriptions (service-role)
Self-serve: createPortalSession(customerId) → Stripe Billing Portal
```

## Client design

- **Lazy singleton** (`getStripe()`): the client is constructed on first use, not at import,
  so modules stay side-effect-free at build time (Stripe v17 throws without a key). This was
  a real build fix, not a hypothetical.
- `apiVersion` pinned to the installed SDK's typed version.
- `PLANS` maps plan → price-env + entitlements (workspaces, generations) used for gating.

## Webhook handler

Node runtime (needs the raw body for signature verification). Handles:

| Event | Action |
|---|---|
| `checkout.session.completed` | Upsert subscription (customer, sub id, plan, `trialing`) |
| `customer.subscription.updated` | Update `status`, `current_period_end` |
| `customer.subscription.deleted` | Mark canceled |

Unhandled events are **acknowledged (200)**, never errored — Stripe retries on non-2xx, so we
only 4xx/5xx on genuine failures. Idempotency: keyed on `stripe_subscription_id` upsert.

## Entitlements & gating

`subscriptions.plan` + `PLANS[plan]` gate: number of workspaces, monthly generations, and
feature access (CRM/Finance/team). The app reads the mirror table (fast, RLS-protected);
Stripe remains the source of truth via webhooks.

## Security

- Secret key + webhook secret are server-only env; never shipped to client.
- Signature verified on every webhook; replay-safe via event idempotency.
- No card data touches our servers — Checkout + Portal are Stripe-hosted (PCI scope minimized).

## Test plan

- `stripe listen --forward-to localhost:3000/api/stripe/webhook` for local e2e.
- Fixtures for each event; assert the `subscriptions` row transitions.
- Trial→active, cancel, and payment-failure paths covered before launch.
