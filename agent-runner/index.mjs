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

import { classifyModelError, isTransientNetworkError, createBackoff } from "./retry.mjs";

const LIFEOS_URL = required("LIFEOS_URL");
const TOKEN = required("LIFEOS_AGENT_TOKEN");
const MODEL_KEY = process.env.MODEL_API_KEY ?? "";
const MODEL_BASE = process.env.MODEL_BASE_URL ?? "https://api.groq.com/openai/v1";
const MODEL = process.env.MODEL ?? "qwen/qwen3.8-27b";

/**
 * Optional second provider, used when the first is rate-limited or down.
 * Any OpenAI-compatible endpoint works — Cerebras is the usual pairing with
 * Groq because both have a free tier and neither shares the other's quota.
 */
const FALLBACK_BASE = process.env.FALLBACK_MODEL_BASE_URL ?? "";
const FALLBACK_KEY = process.env.FALLBACK_MODEL_API_KEY ?? "";
const FALLBACK_MODEL = process.env.FALLBACK_MODEL ?? MODEL;

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
 * Model failures, and whether to wait or give up.
 * Classification and backoff live in retry.mjs so they can be unit-tested —
 * this is the logic that decides whether a user's question is retried or
 * thrown away, and getting it wrong fails silently.
 */
const modelError = (res) => classifyModelError(res, { model: MODEL, base: MODEL_BASE });

const backoff = createBackoff({
  baseMs: Number(process.env.BACKOFF_BASE_MS ?? 5_000),
  maxMs: Number(process.env.BACKOFF_MAX_MS ?? 5 * 60_000),
});

function enterCooldown(err) {
  const wait = backoff.enter(err);
  console.warn(
    `[runner] model unavailable (attempt ${backoff.failures}) — waiting ${Math.round(wait / 1000)}s: ${err.message}`
  );
  return wait;
}

function clearCooldown() {
  if (backoff.clear()) console.log("[runner] model recovered");
}

const inCooldown = () => backoff.active();

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

/**
 * One model call, with a second provider behind it.
 *
 * Free tiers are rate-limited by design, so a single provider means the agent
 * goes quiet exactly when you are using it most. Both endpoints are
 * OpenAI-compatible, so failing over is a different base URL and key — no
 * other code changes. If no fallback is configured this behaves as before.
 */
async function chat(body) {
  const providers = [{ base: MODEL_BASE, key: MODEL_KEY, model: MODEL, name: "primary" }];
  if (FALLBACK_KEY && FALLBACK_BASE) {
    providers.push({ base: FALLBACK_BASE, key: FALLBACK_KEY, model: FALLBACK_MODEL, name: "fallback" });
  }

  let primaryErr;
  for (const p of providers) {
    try {
      const res = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, model: p.model }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw await modelError(res);
      if (p.name === "fallback") console.log(`[runner] answered via fallback provider (${p.model})`);
      return (await res.json()).choices?.[0]?.message?.content ?? "";
    } catch (err) {
      if (p.name === "primary") {
        primaryErr = err;
        // Only fail over for problems the other provider might not have. A
        // malformed request will be just as malformed over there.
        if (!isTransientNetworkError(err)) throw err;
        console.warn(`[runner] primary model failed (${err.message}) — trying fallback`);
        continue;
      }

      // The fallback failed too. Report the PRIMARY's error, because that is
      // the one to act on — surfacing "payment required" from a spare provider
      // when the real problem was a rate limit points at the wrong thing.
      primaryErr.message += ` (fallback also failed: ${err.message})`;
      throw primaryErr;
    }
  }
  throw primaryErr;
}

async function think(context, instruction) {
  if (!MODEL_KEY) return "(no model key configured — dry run)";
  return chat({
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
  });
}

/** Cheap liveness probe + work check. One call, no gate round-trip. */
async function pollInbox() {
  const res = await api("/api/agent/v1/inbox");
  if (!res.ok) throw new Error(`inbox HTTP ${res.status}`);
  return res.json();
}

/**
 * How long a question may be retried before the runner gives up and says so.
 * Long enough to ride out a rate limit, short enough that nobody is left
 * staring at an unanswered message wondering.
 */
const GIVE_UP_AFTER_MS = Number(process.env.GIVE_UP_AFTER_MS ?? 10 * 60_000);

/** Hands a message back to the queue so a later cycle can answer it. */
async function release(msg) {
  await api("/api/agent/v1/inbox", {
    method: "POST",
    body: JSON.stringify({ replyTo: msg.id, release: true }),
  });
}

/**
 * Answers claimed messages and posts each reply back.
 *
 * Returns `retryLater` when it stopped early because the model was
 * unavailable — the caller uses that to wait instead of spinning.
 */
async function handleMessages(context, messages, history) {
  /** Hand back everything we claimed but haven't answered. */
  const releaseFrom = async (index) => {
    for (const m of messages.slice(index)) await release(m);
  };

  for (const [index, msg] of messages.entries()) {
    console.log(`[runner] message: ${msg.content.slice(0, 80)}`);
    let reply;

    try {
      reply = await converse(context, history ?? [], msg.content);
      clearCooldown();

      // If the answer proposes a concrete capture, put it through the gate.
      if (reply.action?.capability) {
        const gate = await propose(reply.action.capability, reply.action.payload ?? {}, 1);
        reply.text += `\n\n— ${gate.decision === "allow" ? "✅" : gate.decision === "approve" ? "⏳" : "🚫"} ${gate.reason}`;
      }
    } catch (err) {
      const age = Date.now() - new Date(msg.created_at).getTime();
      const transient = isTransientNetworkError(err);

      // Record the outage first, whatever we decide about this particular
      // message. Otherwise a batch of old messages each burns a model call
      // against a provider we already know is refusing us.
      const wait = transient ? enterCooldown(err) : 0;

      if (transient && age < GIVE_UP_AFTER_MS) {
        // The provider is having a moment. Put the question back rather than
        // spending it on an error message — the user shouldn't have to retype
        // what they asked because a rate limit happened to land on their turn.
        await releaseFrom(index);
        console.log(
          `[runner] released ${messages.length - index} message(s) for retry in ${Math.round(wait / 1000)}s`
        );
        beat();
        return { handled: index, retryLater: true };
      }

      // Either it will never work (bad key, retired model) or we've retried
      // long enough. Say what actually went wrong instead of staying silent.
      reply = {
        text: isTransientNetworkError(err)
          ? `I couldn't reach the model for the last ${Math.round(age / 60_000)} minutes: ${err.message}\n\nAsk me again in a bit.`
          : `I couldn't process that: ${err.message}`,
      };
      await api("/api/agent/v1/inbox", {
        method: "POST",
        body: JSON.stringify({ replyTo: msg.id, content: reply.text, failed: true }),
      });
      console.log(`[runner] gave up on ${msg.id.slice(0, 8)}: ${err.message}`);
      beat();

      // If the provider is down, stop here: the rest of the batch would only
      // collect the same error. Hand them back so they requeue immediately
      // rather than waiting out the five-minute stale-claim sweep.
      if (inCooldown()) {
        await releaseFrom(index + 1);
        return { handled: index + 1, retryLater: true };
      }
      continue;
    }

    await api("/api/agent/v1/inbox", {
      method: "POST",
      body: JSON.stringify({ replyTo: msg.id, content: reply.text }),
    });
    console.log(`[runner] replied to ${msg.id.slice(0, 8)}`);

    // A model call can take tens of seconds. Report liveness while it runs so
    // the container healthcheck doesn't mistake slow work for a wedged process.
    beat();
  }
  return { handled: messages.length, retryLater: false };
}

/**
 * Answers the user. Asks the model for JSON so a reply can optionally carry a
 * proposed action — which still has to pass the gate before anything happens.
 */
async function converse(context, history, question) {
  if (!MODEL_KEY) return { text: "No model key is configured on the runner, so I can't think yet." };

  const raw = await chat({
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
  });

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

    // The model is in a backoff window. Hand the messages straight back so
    // they stay queued, and don't burn a claim slot waiting.
    if (inCooldown()) {
      for (const msg of messages) await release(msg);
      return Math.max(backoff.remaining(), HOT_POLL_MS);
    }

    const context = await loadContext();
    if (!context) return IDLE_POLL_MS;

    const { retryLater } = await handleMessages(context, messages, history ?? []);
    if (retryLater) return Math.max(backoff.remaining(), HOT_POLL_MS);

    // Stay hot — a reply usually gets a follow-up.
    return HOT_POLL_MS;
  }

  // Background work waits out a provider outage too — there is no point
  // spending retries on busywork while someone may be about to write.
  if (inCooldown()) {
    return Math.min(Math.max(backoff.remaining(), HOT_POLL_MS), IDLE_POLL_MS);
  }

  // Autonomous pass, on its own slow clock. Running this every cycle would
  // burn the daily action quota on busywork within minutes.
  if (Date.now() - lastAutonomousAt >= AUTONOMOUS_MS) {
    lastAutonomousAt = Date.now();
    const context = await loadContext();
    if (context) {
      try {
        const output = await think(
          context,
          "Review the workspace and propose the single highest-leverage next action."
        );
        clearCooldown();
        console.log(`[runner] proposal: ${String(output).slice(0, 160)}`);
        const gate = await propose(
          "brain.write",
          { title: String(output).slice(0, 300), category: "next" },
          1
        );
        console.log(`[runner] brain.write → ${gate.decision} (${gate.reason})`);
      } catch (err) {
        // Background work is not worth retrying hard. Back off and let the
        // next scheduled pass try again.
        if (isTransientNetworkError(err)) enterCooldown(err);
        else console.error(`[runner] autonomous pass failed: ${err.message}`);
      }
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
