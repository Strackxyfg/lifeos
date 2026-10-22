# Editions — Personnel, Solo, Équipe

LifeOS comes in three editions, each containing the one before it:

| Edition | For | Adds |
|---|---|---|
| **Personnel** (Personal) | one's own life | the second brain, the double, mind maps, voice, reminders, the island, the assistant, the agent on the brain, circles |
| **Solo** | founders and independents | projects, clients and deals, dated money and runway, the Friday review, the investor update, the Notion export, the agent on the business, the agent on a server (MCP, Telegram) |
| **Équipe** (Team) | a company | company teams, verified domains, SAML single sign-on, SCIM directory sync, the DPA |

> **Status.** Matrix, resolution and enforcement are tested
> (`tests/editions.test.ts`), and the flow was exercised on the local demo:
> switching from Billing, the navigation, the dashboard, a locked page (desktop
> and 375 px), circles only in Personnel. Billing is **off**: every edition is
> free during early access.

---

## 1. Where it lives

| Piece | File |
|---|---|
| The matrix (`FEATURES`, `HOME`, `includes`, `LIMITS`, `resolveEdition`) | `lib/plans/editions.ts` — pure, used by server and client |
| The edition of the signed-in person, and the checks | `lib/plans/server.ts` — `getEditionState`, `getEdition`, `locked`, `featureRefusal` |
| Changing edition | `app/actions/edition.ts` — `setEdition` |
| A page that needs an edition | `components/plans/edition-gate.tsx` — `<EditionGate feature="crm">` in the route's `layout.tsx` |

The chosen edition is `profiles.answers.edition`, written by the person
(onboarding's last step, or Billing). No migration: `answers` is already a
JSON column. An account that never chose — every account from before the
editions — uses **Équipe**, so nobody loses anything.

## 2. Enforcement — on the server

Hiding a link is not a control. Each write checks the edition itself:

| Feature | Checked in |
|---|---|
| projects, crm, finance | `app/actions/workspace.ts` (`outside(...)`) |
| finance, crm, review | `app/actions/founder.ts` (`ready(feature)`) |
| enterprise | `app/actions/enterprise.ts` (`actor()`) |
| teams (company kind) | `app/actions/team.ts` (`createTeam`); circles are in every edition |
| agent.runner | `app/actions/agent.ts` — minting a runner token, pairing Telegram |
| notion | `app/api/integrations/notion/authorize`, `app/api/generate/stream` (403 `{error:"edition"}`) |

Pages of a Solo feature render `EditionGate` (what the edition adds, a
one-click switch during early access). The navigation shows only what the
edition opens, and names the next edition once ("More with Solo").

What an edition leaves out is **hidden, never deleted**: switching back shows
it again. Runner tokens minted before a downgrade stay valid until revoked.

## 3. Turning billing on

1. Create three prices in Stripe and set `STRIPE_PRICE_PERSONAL`,
   `STRIPE_PRICE_SOLO`, `STRIPE_PRICE_TEAM`.
2. Set `BILLING_ENFORCED=1` (it only takes effect with Supabase).

From then on the subscription caps the choice (`resolveEdition`): the chosen
edition if paid for, the paid one otherwise. The `subscriptions` row is
written only by the Stripe webhook (service role); the person can read it,
never write it. Checkout puts the edition in the session's metadata, and the
webhook stores it — an unknown value stores `personal`, the least.

**Decisions left to the owner** (nothing is published until they are made):

- Without a subscription, `resolveEdition` gives Personnel — whether
  Personnel stays free after early access is one line to change.
- The Équipe price: shown as "set at launch, per seat".
- The former 99 "Souverain" plan is gone: the agent on one's own server is
  now part of Solo.
- Checkout from the Billing page is not wired yet (`createCheckoutSession`
  exists; `setEdition` answers `payment_required` above what is paid for).
