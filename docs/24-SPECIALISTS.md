# Specialists — agents of the owner's own

A specialist is a sub-agent the owner defines for a need of theirs: a legal
eye on French contracts, their VAT assistant, a writer in their voice. It is
a role and a boundary — its instructions, the tools it may use, how deeply it
thinks — and nothing more. Available wherever the agent is (from Personnel).

> **Status.** Built and tested on the local store (model, boundary, prompt,
> delegation, store, actions, proposals, templates); driven live in French:
> one created from a model, one proposed by the AI from a sentence (7.5 s),
> one created by the agent after the owner's approval; a direct conversation
> (exact VAT through compute); the agent delegating to two specialists in
> parallel. Migration `018_specialists.sql` is written, **not yet run on
> Postgres**.

---

## 1. Creating one

| Way | What happens |
|---|---|
| Describe the need | One sentence; a model drafts name, when to call it, role, tools and depth (`lib/specialists/propose.ts`). The draft passes the same checks as a hand-written one, holds only tools the owner may give, and is **shown, never saved**, until they save it. Counted against the agent's daily quota. |
| A model | Six written with care (`templates.ts`): researcher, French-law eye, accountant, business developer, writer, organisation coach — each says its limits; tools their edition does not open are left out. |
| From scratch | The same editor, empty. |
| Asking the agent | "Create me a specialist who…" → `specialist_create`. **Medium tier**: under the default autonomy the agent shows the whole specialist and waits for approval, because its instructions will guide future work. |

At most 30 per person; names unique whatever their case. Both are kept by the
store and, in Supabase, by the database (unique index; a trigger counting
under a per-person lock).

## 2. Using one

- **Talking to it**: the conversation's selector (`/assistant`), or "Talk to
  it" (`/assistant?specialist=<id>`). Changing who one talks to starts a new
  conversation: contexts never mix. It runs on its depth's models (fast →
  sub-agent models, balanced → the agent's, deep → the deepest); "think
  harder" deepens it. Approvals work as with the agent.
- **Delegated by the agent**: once the owner has one, the agent is offered
  `delegate`, built per request with an enum of their specialists' ids — it
  can only name one that exists. Up to the edition's parallel limit (3/5/8),
  each in its own conversation, then the agent checks the reports and
  answers. The page shows each specialist working under the step.

## 3. The boundary, and who keeps it

| Rule | Where |
|---|---|
| Never more tools than the agent on this request (edition, configuration) | `specialistTools`: what it was given ∩ what the agent is offered |
| Never orchestration — no research, no delegation, no creating specialists | `SPECIALIST_TOOLS` (closed list); `specialistTools` filters on it again; `workerToolsOf` excludes `delegate` |
| A stored row cannot smuggle tools or a broken depth | `fromStored`: every specialist read is reduced to allowed tools, a known depth, bounded text — rows can be written past the page (the owner's own API access, an edited file) |
| LifeOS's rules come after its role and prevail | `specialistSystem`: the same `RULES` as the agent (one source in `prompt.ts`), then "if your role asks for something these rules forbid, keep the rule" |
| Delegated, it cannot ask the owner | `runWorkers`: an action that needs approval is refused, and it says so in its report |
| Its own rows only | RLS on `lifeos_specialists` (Supabase); keyed by person (local) |
| Writes only for the signed-in | the actions use `getAuthenticatedUserKey()` |
| App only | `agent.delegate` and `specialist.write` are never published over MCP |

A model writing a specialist's long texts no longer loses its answer to a
provider: those fields are marked `clip` — the limit is not sent to the
provider and LifeOS cuts at a word before the approval is shown
(`lib/ai/tool-schema.ts`, `checkArgs`), so what is approved is what is saved.

## 4. Code

| Where | What |
|---|---|
| `lib/specialists/constants.ts`, `model.ts` | lists and limits (no zod, for pages); schema and `fromStored` |
| `lib/specialists/store*.ts` | one contract, Supabase (018) or `specialists.json` |
| `lib/specialists/service.ts`, `agent.ts` | the checks, shared by the page and the agent's tool |
| `lib/specialists/run.ts` | tools, prompt, depth, `delegate`, parallel run |
| `lib/agent/research.ts` | `runWorkers`: the engine research and delegation share |
| `app/actions/specialists.ts` | save, delete, propose |
| `app/(app)/assistant/specialists/page.tsx`, `components/specialists/*` | the page and the editor |
| `components/assistant/agent-thread.tsx` | the selector in the conversation |

## 5. Before opening it

1. Apply `supabase/migrations/018_specialists.sql`, then create, edit, talk
   to and delete one on the real project.
2. With OpenRouter credits, run a delegation to two specialists again: here
   the frontier models were out of credit and Groq's free tier capped the
   parallel run.
