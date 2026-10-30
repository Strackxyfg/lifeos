# The agent in the app

The Assistant page is a complete assistant, in every domain, that is also the
person's double: it knows them through their second brain, searches and reads
the web, calculates exactly in a sandbox, sends research sub-agents in
parallel for questions that need many sources, acts on LifeOS with tools —
and stops for the owner's approval on anything that leaves it. It runs on the
router's best model for agents (with an OpenRouter key: Claude Sonnet 5.5,
then GPT-6.1 Sol, Gemini 4…; Claude Opus 5.5 for "think harder"), in every
edition, without Supabase if need be.

> **Status.** Loop, tools, policy, provenance, research, sandbox, web search
> parsing, OpenRouter routing and reasoning, Markdown and the page model are
> tested (`tests/agent-*.test.ts`, `ai-openrouter.test.ts`: 1062 tests in
> all). Checked live on the demo with Groq: exact calculations through the
> sandbox (savings over 12 years, a percentage spread over months), an answer
> grounded in the notes with two reads in parallel, the steps and programs on
> the page. **Not checked live**: web search and the frontier models — the
> OpenRouter key in `.env.local` was refused (401 "User not found"); research
> sub-agents in parallel, which exceed Groq's free per-minute limit.

---

## 1. How a request runs

`POST /api/agent/chat` (NDJSON stream) → `lib/agent/loop.ts`:

1. The model gets the system prompt (`prompt.ts`): the date on the person's
   clock, what their double knows of them (`persona.ts`), how to work, the
   rules no tool result can change — and the tools their edition opens.
2. Each tool call is checked (known tool, valid JSON, arguments against a
   strict schema, lists and objects included), then decided by the **same
   policy engine as the runner** (`policy.ts`): allow, ask the owner, refuse.
3. Allowed calls run through the **same executor** as the runner and MCP
   (`execute.ts`), and are journaled. Calls that only read run **at the same
   time**; a write runs on its own. Results return in the order asked.
4. Until the model answers without a tool, needs approval, or reaches the
   step limit of the edition (12 / 20 / 30 model turns per request).

Approval pauses the request; the page shows the exact action. The decision is
a new request that decides again (kill switch, edition, forbidden actions
still win) and continues. The conversation lives in the tab, with each
provider's own reasoning sent back to the model that wrote it (OpenRouter's
`reasoning_details`, Claude's thinking, DeepSeek's reasoning, OpenAI's
encrypted items); nothing the browser sends decides anything.

## 2. The double at work

`persona.ts` builds, on each request, from the person's own data: name, work
and areas; their open goals; what deserves their attention now (the focus);
the portrait they confirmed (and, marked as such, what they have not); their
check-in rhythms; in French, "tu" or "vous" as they write, and the gender
agreement they use (none when unknown). When they write for the person, it
writes the way the person writes. If their last messages sound like distress
or danger, their safety comes before any task, and the page shows who to call.

## 3. Tools

| Tool | Capability | Tier | Edition |
|---|---|---|---|
| web_search | web.search (OpenRouter web plugin, Exa) | safe | Personnel (needs an OpenRouter key) |
| web_read | web.research — now with the page's links | medium, **free when the address is known** | Personnel |
| compute | compute (QuickJS in WebAssembly) | safe | Personnel |
| research | agent.research (app only) | low | Personnel: 3 sub-agents × 6 steps; Solo 5 × 8; Team 8 × 10 |
| brain_search, brain_overview, brain_note | brain.* | safe | Personnel |
| self_portrait | self.read | safe | Personnel (migration 015) |
| note_create, notes_connect, task_create, reminder_create | brain.write / link, task.write, reminder.write | low | Personnel |
| workspace_overview, project_create, deal_create | workspace.read, project/deal.write | safe / low | Solo |
| email_draft, proposal_draft, email_send | email/proposal.draft, email.send | low / high | Solo (Supabase; sending needs Resend) |

**Research.** The lead splits the question; each part goes to a sub-agent
with its own conversation and read-only tools (search, read, brain, compute),
on fast models (Claude Haiku 5.5, DeepSeek V4.1 Flash…), four at a time. They
cannot write or ask the owner. The lead gets their reports and the list of
pages they actually opened, and writes the synthesis.

**Sandbox.** No network, no files, nothing of the server; 5 s, 64 MB, 1 MB of
stack; the last value and what it printed come back.

## 4. Safety

- **Where a web address came from** (`provenance.ts`). A page is read freely
  when its address was written by the owner or returned by the web itself
  (search results, a read page's links, the pages sub-agents opened — listed
  by LifeOS, not by a model). An address a model composed — where it could
  have put something from the notes — waits for the owner's approval, which
  shows it in full. Sub-agents simply cannot read such a page.
- **Prompt injection.** Tool results are data; text that addresses an AI is
  flagged to the model and on the page. Web content is fenced as untrusted.
- **Web reading (SSRF).** http/https on 80/443, the address checked inside
  the connection's own DNS lookup, redirects re-checked, 10 s, 1.5 MB.
- **The endpoint.** Signed in, same origin, JSON, 1.5 MB; requests per
  edition per day (40 / 150 / 400). Research cannot be called through MCP.

## 5. Keys and cost

With `OPENROUTER_API_KEY` (valid, with credit) the agent leads with Claude
Sonnet 5.5 (about $2 / $10 per million tokens in / out), searches the web
(about $0.007 a search) and runs sub-agents on Claude Haiku 5.5 ($0.10 /
$0.50). The page shows what each answer cost when the provider reports it.
Without it, the agent runs on Groq / Mistral / Cerebras, without web search.
