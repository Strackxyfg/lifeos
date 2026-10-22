"use client";

import { parseDoubleActions, tidyAnswer, type DoubleAction } from "@/lib/self/double";
import { careOf, type Care } from "@/lib/self/care";
import { neutralFrench } from "@/lib/self/voice";

/**
 * One exchange with the double, as both the conversation and the question
 * of the day hold it, and the call that streams its answer.
 */

export interface DoubleTurn {
  role: "user" | "assistant";
  content: string;
  /** The question of the day this message answers, shown above it and given to the double with it. */
  question?: string;
  actions?: DoubleAction[];
  sources?: { id: string; t: string }[];
  /** Index of each action accepted. */
  accepted?: number[];
  /** How heavy the exchange is: a crisis shows who to call, whatever the answer says. */
  care?: Care;
}

const decode = <T,>(header: string | null, fallback: T): T => {
  if (!header) return fallback;
  try {
    return JSON.parse(decodeURIComponent(header)) as T;
  } catch {
    return fallback;
  }
};

const isCare = (v: string | null): v is Care => v === "none" || v === "distress" || v === "crisis";

/** What the double is sent for a message: the question it answers, then the answer. */
export function wireText(turn: DoubleTurn, questionLabel: string, locale: string): string {
  if (!turn.question) return turn.content;
  const q = locale === "fr" ? `« ${turn.question} »` : `“${turn.question}”`;
  return `${questionLabel}${locale === "fr" ? " :" : ":"} ${q}\n\n${turn.content}`;
}

export interface Streamed {
  ok: boolean;
  text: string;
  actions: DoubleAction[];
  sources: { id: string; t: string }[];
  care: Care;
}

/**
 * Asks the double, streaming its answer to `onText` as it comes (the
 * actions block never shown). The care level is read here too, from what
 * they wrote, so help is on screen before the first word of the answer.
 */
export async function streamDouble(opts: {
  turns: DoubleTurn[];
  mode: "chat" | "answer";
  /** In "answer" mode, the note their answer became: not given back to the double as one of their notes. */
  answerNote?: string;
  locale: string;
  zone: string;
  questionLabel: string;
  onText: (visible: string) => void;
  onCare?: (care: Care) => void;
}): Promise<Streamed> {
  const said = opts.turns.filter((t) => t.role === "user").map((t) => t.content);
  let care: Care = careOf(said);
  opts.onCare?.(care);
  let raw = "";
  let refs: Record<string, string> = {};
  let sources: { id: string; t: string }[] = [];
  let ok = true;
  // In French, when the double does not know how they speak of themselves, no gendered turn reaches the page.
  let shape = (text: string) => tidyAnswer(text);
  try {
    const res = await fetch("/api/self/double", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: opts.turns.map((t) => ({ role: t.role, content: wireText(t, opts.questionLabel, opts.locale) })),
        locale: opts.locale,
        zone: opts.zone,
        mode: opts.mode,
        answerNote: opts.answerNote,
      }),
    });
    if (!res.ok || !res.body) throw new Error(String(res.status));
    refs = decode(res.headers.get("X-Double-Goals"), {});
    sources = decode(res.headers.get("X-Brain-Sources"), []);
    const told = res.headers.get("X-Double-Care");
    // The server's reading counts too: the gravest of the two.
    if (isCare(told) && (told === "crisis" || (told === "distress" && care === "none"))) {
      care = told;
      opts.onCare?.(care);
    }
    if (res.headers.get("X-AI") === "invalid" || res.headers.get("X-AI") === "error") ok = false;
    if (opts.locale === "fr" && res.headers.get("X-Double-Gender") !== "m" && res.headers.get("X-Double-Gender") !== "f") shape = (text) => neutralFrench(tidyAnswer(text));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      opts.onText(shape(raw));
    }
    raw += decoder.decode();
  } catch {
    ok = false;
  }
  return { ok: ok && !!tidyAnswer(raw), text: shape(raw), actions: parseDoubleActions(raw, new Map(Object.entries(refs))), sources, care };
}
