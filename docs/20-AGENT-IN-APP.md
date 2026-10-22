# The agent in the app

The Assistant page is now an agent: it looks things up in the second brain,
acts on it with tools, and stops for the owner's approval on anything that
leaves LifeOS. It runs on the router's best tool-calling model (frontier tier
first: Claude, GPT, DeepSeek V4 Pro, Kimi… — see `lib/ai/router.ts`), in every
edition, without Supabase if need be.

> **Status.** Loop, tools, policy, web reading and the page model are tested
> (`tests/agent-loop.test.ts`, `agent-web.test.ts`, `agent-view.test.ts`).
> Checked live on the demo with Groq (gpt-oss-120b; qwen3.8-27b and
> gpt-oss-20b took over under Groq's rate limits): a search answered from the
> notes, a reminder and a task created in one request (date right on the
> Paris clock), a web page read after approval, an injected instruction in a
> note not obeyed and flagged, desktop and 375 px. Claude, OpenAI, DeepSeek
> and OpenRouter are unit-tested only: no key was available.

---

## 1. How a request runs

`POST /api/agent/chat` (NDJSON stream) → `lib/agent/loop.ts`:

1. The model gets the system prompt (`lib/agent/prompt.ts`: the date on the
   person's clock, who they are, the rules), the conversation, and the tools
   their edition opens (`lib/agent/tools.ts`).
2. Each tool call is checked (known tool, valid JSON, arguments against a
   strict schema), then decided by the **same policy engine as the runner**
   (`policy.ts`): allow, ask the owner, or refuse.
3. Allowed calls run through the **same executor** as the runner and MCP
   (`execute.ts`), and are journaled (`agent_audit` with Supabase,
   `.data/agent-audit.jsonl` without). The result goes back to the model.
4. Until the model answers without calling a tool, needs approval, or reaches
   the step limit of the edition (8 / 16 / 24 model turns per request).

A call that needs approval pauses the request; the page shows a card with the
exact arguments. The owner's decision is a new request (`decision`), which
decides again — kill switch, edition, forbidden actions still win — runs or
declines the call, answers the calls after it, and continues.

The conversation lives in the tab (sessionStorage), including the providers'
own reasoning for the next step (Claude's thinking, DeepSeek's reasoning,
OpenAI's encrypted items). Nothing the browser sends decides anything: it is
checked for shape and size, has no system message, and every tool, decision
and effect is decided on the server again.

## 2. Tools

| Tool | Capability | Tier | Edition |
|---|---|---|---|
| brain_search, brain_overview, brain_note | brain.search / read / related | safe | Personnel |
| self_portrait | self.read | safe | Personnel (migration 015) |
| note_create, notes_connect | brain.write / link | low | Personnel |
| task_create | task.write | low | Personnel |
| reminder_create | reminder.write (new) | low | Personnel (migration 011) |
| web_read | web.research (now implemented) | medium | Personnel |
| workspace_overview | workspace.read | safe | Solo |
| project_create, deal_create | project.write / deal.write | low | Solo |
| email_draft, proposal_draft | email.draft / proposal.draft | low | Solo (Supabase) |
| email_send | email.send | high — always asks | Solo (Supabase + Resend) |

`reminder.write` and `web.research` live in the shared executor, so the
runner and MCP clients get them too.

**Autonomy.** The owner's level from `agent_policies` if they set one,
otherwise `act`: reads and writes inside LifeOS run, anything outside asks,
high-risk always asks, the forbidden never runs. "Ask before every change"
lowers it to `assist` for a request; nothing on a request can raise it. A
failed policy read gives `assist`.

## 3. Safety

- **Prompt injection.** Tool results are data: the prompt says so, and
  results whose text speaks to an AI ("ignore your instructions", "instruction
  pour l'assistant"…) are prefixed with a warning to the model and flagged on
  the page, whatever the model does. Web pages are fenced as untrusted.
- **Web reading (SSRF).** http/https on ports 80/443 only, no credentials,
  no internal names; the address is checked **inside the connection's own
  DNS lookup** (no rebinding), redirects re-checked, 10 s and 1.5 MB at most,
  text types only (`lib/agent/web.ts`).
- **The endpoint.** Signed in, same origin, JSON only, 1.5 MB at most,
  requests counted per edition per day (40 / 150 / 400).

## 4. Keys

The agent uses the strongest tool-calling model configured. Add any of
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
`OPENROUTER_API_KEY` to put a frontier model first; without them it runs on
Groq / Mistral / Cerebras.
