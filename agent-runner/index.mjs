#!/usr/bin/env node
/**
 * LifeOS Agent Runner — runs on a VPS, never on the owner's machine.
 *
 * Security model:
 *   • Holds exactly two secrets: LIFEOS_AGENT_TOKEN (scoped, revocable) and a
 *     model API key. No database credentials, no Notion token, no Supabase key.
 *   • Executes nothing locally. Every action is proposed to LifeOS `/act`,
 *     which runs the policy engine and answers allow / approve / deny.
 *   • Outbound network is restricted to LIFEOS_URL and the model endpoint.
 *   • Fails closed: any error, timeout or non-allow answer stops the step.
 */

const LIFEOS_URL = required("LIFEOS_URL");
const TOKEN = required("LIFEOS_AGENT_TOKEN");
const MODEL_KEY = process.env.MODEL_API_KEY ?? "";
const MODEL_BASE = process.env.MODEL_BASE_URL ?? "https://api.groq.com/openai/v1";
const MODEL = process.env.MODEL ?? "qwen/qwen3.8-27b";

/**
 * Polling cadence.
 *
 * A single 30 s interval made every reply feel broken: a message sent one
 * second after a poll waited the best part of half a minute before the agent
 * even looked. But polling fast around the clock is wasteful when nobody is
 * talking, so the runner does both — it drops to a ~1.5 s cycle while a
 * conversation is live and settles back to a slow cycle when it goes quiet.
 */
const IDLE_POLL_MS = Number(process.env.POLL_MS ?? 10_000);
const HOT_POLL_MS = Number(process.env.HOT_POLL_MS ?? 1_500);
/** How long a conversation stays "live" after the last message. */
const HOT_WINDOW_MS = Number(process.env.HOT_WINDOW_MS ?? 120_000);
/** Background work runs on its own slow clock, not once per poll. */
const AUTONOMOUS_MS = Number(process.env.AUTONOMOUS_MS ?? 15 * 60_000);
/** Workspace facts change slowly; re-fetching them every cycle is pure latency. */
const CONTEXT_TTL_MS = Number(process.env.CONTEXT_TTL_MS ?? 60_000);

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[runner] missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

/**
 * Turns a model-endpoint failure into something diagnosable.
 *
 * A bare "HTTP 404" is ambiguous, and the most common cause is the least
 * obvious one: providers retire model names, so a config that worked last
 * month starts 404-ing with no other symptom.
 */
async function modelError(res) {
  const detail = await res.text().catch(() => "");
  const short = detail.slice(0, 200);
  if (res.status === 404) {
    return new Error(
      `model "${MODEL}" not found at ${MODEL_BASE} (HTTP 404) — it may have been ` +
        `decommissioned by the provider. List current models: ` +
        `curl -H "Authorization: Bearer $MODEL_API_KEY" ${MODEL_BASE}/models`
    );
  }
  if (res.status === 401 || res.status === 403) {
    return new Error(`model auth rejected (HTTP ${res.status}) — check MODEL_API_KEY. ${short}`);
  }
  if (res.status === 429) return new Error("model rate-limited (HTTP 429) — backing off");
  return new Error(`model HTTP ${res.status} ${short}`);
}

const api = (path, init = {}) =>
  fetch(`${LIFEOS_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

/** Ask LifeOS whether an action is permitted. Never assume yes. */
async function propose(capability, payload, costCents = 0) {
  try {
    const res = await api("/api/agent/v1/act", {
      method: "POST",
      body: JSON.stringify({ capability, payload, costCents }),
    });
    const body = await res.json().catch(() => ({}));
    return { decision: body.decision ?? "deny", reason: body.reason ?? `HTTP ${res.status}` };
  } catch (err) {
    // Fail closed: if the gate is unreachable, nothing runs.
    return { decision: "deny", reason: `gate unreachable: ${err.message}` };
  }
}

let contextCache = { value: null, at: 0 };

/**
 * Workspace context, memoised for CONTEXT_TTL_MS.
 *
 * Previously this ran on every cycle: a gate round-trip plus a context fetch
 * before the runner had even checked whether there was anything to do. On a
 * fast poll that would be two needless network hops per second.
 */
async function loadContext(force = false) {
  if (!force && contextCache.value && Date.now() - contextCache.at < CONTEXT_TTL_MS) {
    return contextCache.value;
  }

  const gate = await propose("brain.read", { intent: "load context" });
  if (gate.decision !== "allow") {
    console.log(`[runner] context denied — ${gate.reason}`);
    return null;
  }
  const res = await api("/api/agent/v1/context");
  if (!res.ok) throw new Error(`context HTTP ${res.status}`);

  const value = await res.json();
  contextCache = { value, at: Date.now() };
  return value;
}

async function think(context, instruction) {
  if (!MODEL_KEY) return "(no model key configured — dry run)";
  const res = await fetch(`${MODEL_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MODEL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content:
            "You are the LifeOS background agent. You may only propose actions; " +
            "a policy engine decides whether they run. Be concrete and brief. " +
            "Never claim to have done something you were not allowed to do.",
        },
        { role: "user", content: `Workspace facts:\n${JSON.stringify(context.snapshot)}\n\nTask: ${instruction}` },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await modelError(res);
  const body = await res.json();
  return body.choices?.[0]?.message?.content ?? "";
}

/** Cheap liveness probe + work check. One call, no gate round-trip. */
async function pollInbox() {
  const res = await api("/api/agent/v1/inbox");
  if (!res.ok) throw new Error(`inbox HTTP ${res.status}`);
  return res.json();
}

/** Answers claimed messages and posts each reply back. */
async function handleMessages(context, messages, history) {
  for (const msg of messages) {
    console.log(`[runner] message: ${msg.content.slice(0, 80)}`);
    let reply;
    let failed = false;

    try {
      reply = await converse(context, history ?? [], msg.content);

      // If the answer proposes a concrete capture, put it through the gate.
      if (reply.action?.capability) {
        const gate = await propose(reply.action.capability, reply.action.payload ?? {}, 1);
        reply.text += `\n\n— ${gate.decision === "allow" ? "✅" : gate.decision === "approve" ? "⏳" : "🚫"} ${gate.reason}`;
      }
    } catch (err) {
      failed = true;
      reply = { text: `I couldn't process that: ${err.message}` };
    }

    await api("/api/agent/v1/inbox", {
      method: "POST",
      body: JSON.stringify({ replyTo: msg.id, content: reply.text, failed }),
    });
    console.log(`[runner] replied to ${msg.id.slice(0, 8)}${failed ? " (failed)" : ""}`);

    // A model call can take tens of seconds. Report liveness while it runs so
    // the container healthcheck doesn't mistake slow work for a wedged process.
    beat();
  }
  return messages.length;
}

/**
 * Answers the user. Asks the model for JSON so a reply can optionally carry a
 * proposed action — which still has to pass the gate before anything happens.
 */
async function converse(context, history, question) {
  if (!MODEL_KEY) return { text: "No model key is configured on the runner, so I can't think yet." };

  const res = await fetch(`${MODEL_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MODEL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are the LifeOS agent — the user's second self, working on their " +
            "business. You may PROPOSE actions but a policy engine decides whether " +
            "they run — never claim to have done something. Reply ONLY as JSON: " +
            '{"text": "<your reply>", "action": null | {"capability": "<id>", "payload": {…}}}.\n' +
            "Capabilities you may propose:\n" +
            '  brain.write {title, detail, category}     — capture a note\n' +
            '  task.write {label}                        — add a task\n' +
            '  project.write {name, status}              — start a project\n' +
            '  deal.write {name, company, stage, value}  — update the sales pipeline\n' +
            '  email.draft {to, subject, body}           — draft an email for approval\n' +
            '  campaign.draft {audience, subject, body}  — plan an ad campaign\n' +
            '  proposal.draft {target, subject, body}    — write a sales proposal\n' +
            "Prefer drafting over sending: drafts are free and the owner approves the " +
            "send. Write the full, finished text — never a placeholder or a promise " +
            "to write it later.\n" +
            `Workspace facts: ${JSON.stringify(context.snapshot)}. ` +
            `Current autonomy: ${context.policy.autonomy}.`,
        },
        ...history.map((h) => ({ role: h.role === "agent" ? "assistant" : "user", content: h.content })),
        { role: "user", content: question },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw await modelError(res);

  const body = await res.json();
  const raw = body.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(raw);
    return { text: String(parsed.text ?? raw).slice(0, 4000), action: parsed.action ?? null };
  } catch {
    return { text: String(raw).slice(0, 4000) };
  }
}

let lastAutonomousAt = 0;
let lastMessageAt = 0;

/**
 * One cycle. Returns how long to wait before the next one.
 *
 * Order matters for responsiveness: the inbox is checked first because it is
 * one cheap call that answers both "is anyone waiting" and "am I switched on".
 * Everything more expensive happens only once there is a reason for it.
 */
async function tick() {
  const { messages, history, control } = await pollInbox();

  if (control?.killSwitch) {
    console.log("[runner] kill switch is on — idle");
    return IDLE_POLL_MS;
  }

  // Messages first: a waiting human beats background work.
  if (messages?.length) {
    lastMessageAt = Date.now();
    const context = await loadContext();
    if (!context) return IDLE_POLL_MS;
    await handleMessages(context, messages, history ?? []);
    // Stay hot — a reply usually gets a follow-up.
    return HOT_POLL_MS;
  }

  // Autonomous pass, on its own slow clock. Running this every cycle would
  // burn the daily action quota on busywork within minutes.
  if (Date.now() - lastAutonomousAt >= AUTONOMOUS_MS) {
    lastAutonomousAt = Date.now();
    const context = await loadContext();
    if (context) {
      const output = await think(
        context,
        "Review the workspace and propose the single highest-leverage next action."
      );
      console.log(`[runner] proposal: ${String(output).slice(0, 160)}`);
      const gate = await propose(
        "brain.write",
        { title: String(output).slice(0, 300), category: "next" },
        1
      );
      console.log(`[runner] brain.write → ${gate.decision} (${gate.reason})`);
    }
  }

  // Keep checking quickly for a little while after the last exchange.
  return Date.now() - lastMessageAt < HOT_WINDOW_MS ? HOT_POLL_MS : IDLE_POLL_MS;
}

console.log(
  `[runner] starting · lifeos=${LIFEOS_URL} · model=${MODEL} · ` +
    `poll=${HOT_POLL_MS}ms active / ${IDLE_POLL_MS}ms idle · autonomous every ${AUTONOMOUS_MS / 60_000}min`
);

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stopping = true;
    console.log(`[runner] ${sig} — shutting down`);
    process.exit(0);
  });
}

// Written after every cycle — including failed ones, since a runner that is
// looping and reporting errors is alive. The container healthcheck fails only
// if this stops being touched, i.e. the process is genuinely wedged.
const HEARTBEAT = process.env.HEARTBEAT_FILE ?? "/tmp/lifeos-agent-heartbeat";
const { writeFileSync } = await import("node:fs");

function beat() {
  try {
    writeFileSync(HEARTBEAT, new Date().toISOString());
  } catch {
    /* heartbeat is best-effort */
  }
}

while (!stopping) {
  let wait = IDLE_POLL_MS;
  try {
    wait = await tick();
  } catch (err) {
    console.error("[runner] tick failed:", err.message);
  }
  beat();
  await new Promise((r) => setTimeout(r, wait));
}
