import "server-only";
import { ai } from "./router";
import { extractJson } from "./json";
import type { NoteLike } from "@/lib/brain/graph";
import type { Locale } from "@/lib/i18n/config";
import { noteText, sanitizeTraits, type Extraction, type TraitLike } from "@/lib/self/portrait";

/**
 * The double reading notes for the portrait.
 *
 * The model proposes; `sanitizeTraits` decides. Whatever the model claims,
 * a trait is kept only if the words it quotes are really in the note it
 * cites, it does not repeat one the person rejected, and it stays within
 * the portrait's dimensions — so a fluent invention cannot reach the page.
 */

const REGION: Record<string, string> = {
  goals: "goal",
  next: "next step",
  ideas: "idea",
  thoughts: "thought",
  knowledge: "knowledge",
  insights: "insight",
};

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

function portraitSystem(language: "French" | "English"): string {
  return [
    "You are one person's double: you read their second brain to understand who they are — not what they did today,",
    "but what stays true about them. From their numbered notes, draw traits: short statements about them, each in one",
    "of these dimensions:",
    "- values: what matters to them, what they protect or want more of.",
    "- drives: what moves them — ambitions, motivations, what they want their life or work to become.",
    "- strengths: what they are good at, by their own account or by what they report doing well.",
    "- obstacles: what holds them back — recurring difficulties, fears they name, habits they want to change.",
    "- rhythms: how they work and live best — times of day, energy, conditions, methods that work for them.",
    "- principles: rules they live by, lessons they have drawn and keep.",
    "- people: people who matter to them, named, with who they are to them.",
    "- interests: subjects, activities and fields they are drawn to.",
    "",
    "Rules:",
    "- Every trait rests on their words: \"evidence\" quotes, word for word, 3 to 25 consecutive words of the note it",
    "  cites (by its id, n1, n2…). No exact quote, no trait.",
    "- Stay close to what they wrote. Never diagnose, label or psychologise (\"anxious\", \"perfectionist\") unless they",
    "  say it of themselves. Never infer health, religion, politics, sexuality or ethnic origin.",
    "- A one-off task or event is not a trait. Prefer what recurs, or what they state as true about themselves.",
    `- Write each statement in ${language}, addressed to them${language === "French" ? " with \"vous\" (\"Vous travaillez mieux le matin\")" : " (\"You work best in the morning\")"},`,
    "  in one sentence under 140 characters.",
    ...(language === "French"
      ? [
          "- You do not know their gender: never write an adjective or participle that agrees with it (\"vous êtes intéressé\",",
          "  \"motivée\"). Turn it so none is needed: \"L'entrepreneuriat vous intéresse\", \"Vous aimez…\", \"Ce qui vous motive…\".",
        ]
      : []),
    "- When a trait in KNOWN already says it, do not repeat it: return {\"existing\":\"t3\",\"evidence\":[…]} to add evidence.",
    "- Never propose anything close to a statement in REJECTED: they said it is not them.",
    "- At most 8 traits. If the notes say nothing lasting about them, return {\"traits\":[]}.",
    "",
    "Answer with JSON only:",
    "{\"traits\":[{\"dimension\":\"rhythms\",\"statement\":\"...\",\"evidence\":[{\"note\":\"n4\",\"quote\":\"...\"}]},",
    " {\"existing\":\"t2\",\"evidence\":[{\"note\":\"n1\",\"quote\":\"...\"}]}]}",
  ].join("\n");
}

/**
 * Traits from up to 30 notes, validated. `traits` is everything the person
 * already has (the model is shown the non-rejected ones by reference, and the
 * rejected ones as statements not to repeat).
 */
export async function extractTraits(input: { notes: NoteLike[]; traits: TraitLike[]; locale: Locale }): Promise<Extraction> {
  const notes = input.notes.slice(0, 30);
  if (notes.length === 0) return { proposals: [], support: [], dropped: [] };
  const known = input.traits.filter((t) => t.status !== "rejected").slice(0, 40);
  const rejected = input.traits.filter((t) => t.status === "rejected").slice(0, 30);
  const noteRefs = new Map(notes.map((n, i) => [`n${i + 1}`, { id: n.id, text: noteText(n) }]));
  const traitRefs = new Map(known.map((t, i) => [`t${i + 1}`, t]));
  const language = input.locale === "fr" ? "French" : "English";

  const raw = (
    await ai().complete({
      task: "portrait",
      messages: [
        { role: "system", content: portraitSystem(language) },
        {
          role: "user",
          content: [
            ...(known.length ? ["KNOWN", ...known.map((t, i) => `t${i + 1} (${t.dimension}) ${clip(oneLine(t.statement), 160)}`), ""] : []),
            ...(rejected.length ? ["REJECTED — never propose these again", ...rejected.map((t) => `- ${clip(oneLine(t.statement), 160)}`), ""] : []),
            "NOTES",
            ...notes.map((n, i) => {
              const detail = n.detail ? ` — ${clip(oneLine(n.detail), 400)}` : "";
              return `n${i + 1} [${REGION[n.category] ?? n.category}] ${clip(oneLine(n.title), 220)}${detail}`;
            }),
          ].join("\n"),
        },
      ],
      maxTokens: 900,
      temperature: 0.2,
      json: true,
      validate: (text) => Array.isArray((extractJson(text) as { traits?: unknown } | null)?.traits),
    })
  ).value;

  return sanitizeTraits(extractJson(raw), { notes: noteRefs, known: traitRefs, all: input.traits });
}
