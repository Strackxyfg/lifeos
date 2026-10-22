import { normalize } from "./care";

/**
 * How a person speaks of themselves, so their double speaks the same way.
 *
 *  - The register: "tu" if that is what they write to their double, "vous"
 *    otherwise. A double that answers "vous" to someone who says "tu"
 *    sounds like a stranger.
 *  - In French, the grammatical gender they use for themselves — "je me
 *    suis livré", "je suis fatiguée". Read only from their own first-person
 *    sentences, never guessed from a first name or anything else, and never
 *    kept: it only lets the double agree with them as they agree with
 *    themselves. When they have not written it, or wrote both, the double
 *    stays neutral.
 */

export function registerOf(userMessages: string[]): "tu" | "vous" {
  let tu = 0;
  let vous = 0;
  for (const raw of userMessages) {
    const s = ` ${normalize(raw)} `;
    tu += (s.match(/[^a-z](?:tu|toi)(?=[^a-z])/g) ?? []).length + (s.match(/[^a-z]t'(?=[a-z])/g) ?? []).length;
    vous += (s.match(/[^a-z]vous(?=[^a-z])/g) ?? []).length;
  }
  return tu > 0 && tu >= vous ? "tu" : "vous";
}

/**
 * Adjectives whose two forms differ beyond a final "e" on an "é" — read on
 * the raw (accented) text: masculine, feminine.
 */
const PAIRS: [string, string][] = [
  ["content", "contente"],
  ["prêt", "prête"],
  ["sûr", "sûre"],
  ["seul", "seule"],
  ["fier", "fière"],
  ["heureux", "heureuse"],
  ["malheureux", "malheureuse"],
  ["déçu", "déçue"],
  ["perdu", "perdue"],
  ["inquiet", "inquiète"],
  ["nul", "nulle"],
  ["épuisant", "épuisante"],
  ["anxieux", "anxieuse"],
  ["curieux", "curieuse"],
  ["sérieux", "sérieuse"],
  ["paresseux", "paresseuse"],
  ["mort", "morte"],
  ["né", "née"],
  ["venu", "venue"],
  ["parti", "partie"],
  ["sorti", "sortie"],
  ["convaincu", "convaincue"],
  ["détendu", "détendue"],
  ["tendu", "tendue"],
];

/** "je suis", "je me suis", "je me sens", "je reste", "je deviens"… with up to two words between (pas, vraiment, tellement…). */
const SELF = "\\bje (?:me )?(?:suis|sens|reste|deviens|serai|serais|me suis senti|me suis sentie|étais|me sentais)(?: (?:pas|plus|vraiment|tellement|très|trop|si|complètement|super|toujours|un peu|assez|jamais|encore|déjà|souvent|parfois)){0,2} ";

const MASC_E = new RegExp(`${SELF}([a-zàâçéèêëîïôûùüÿœ]+?é)(?![a-zàâçéèêëîïôûùüÿœ])`, "giu");
const FEM_E = new RegExp(`${SELF}([a-zàâçéèêëîïôûùüÿœ]+?ée)(?![a-zàâçéèêëîïôûùüÿœ])`, "giu");

const word = (w: string) => new RegExp(`${SELF}${w}(?![a-zàâçéèêëîïôûùüÿœ])`, "iu");
const PAIR_RES = PAIRS.filter(([m, f]) => m !== f).map(([m, f]) => [word(m), word(f)] as const);

/** Keeps the first letter's case of what it replaces. */
const keepCase = (from: string, to: string) => (from[0] && from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

const NEUTRAL: [RegExp, (m: string, ...g: string[]) => string][] = [
  // The person: "vous n'êtes pas seul" → "vous n'êtes pas sans soutien".
  [/\b(vous n'êtes|tu n'es) pas seul(?![a-zàâçéèêëîïôûùüÿœ·])/giu, (m, who) => keepCase(m, `${who} pas sans soutien`)],
  // "porter tout ça seul" → "porter tout ça sans aide".
  [
    /\b(porter|affronter|gérer|traverser|vivre|supporter|assumer|décider)((?: [^.!?\n,;:]{1,40}?)?) seul(?![a-zàâçéèêëîïôûùüÿœ·])/giu,
    (m, verb, rest) => `${verb}${rest ?? ""} sans aide`,
  ],
  // The double of itself: "je suis désolé" → "je regrette", "je suis content que" → "ça me fait plaisir que"…
  [/\bje suis (?:(vraiment|sincèrement|tellement|très) )?désolé(?![a-zàâçéèêëîïôûùüÿœ·])/giu, (m, adv) => keepCase(m, adv ? "je regrette vraiment" : "je regrette")],
  [/\bje suis (?:(vraiment|sincèrement|tellement|très) )?(?:content|heureux|ravi)(?![a-zàâçéèêëîïôûùüÿœ·])/giu, (m, adv) => keepCase(m, adv ? "ça me fait vraiment plaisir" : "ça me fait plaisir")],
  [/\bje suis (?:(vraiment|sincèrement|tellement|très) )?touché(?![a-zàâçéèêëîïôûùüÿœ·])/giu, (m, adv) => keepCase(m, adv ? "ça me touche vraiment" : "ça me touche")],
];

/**
 * When the double does not know how someone speaks of themselves, a few
 * turns a model still slips into anyway — "porter tout ça seul", "je suis
 * désolé" — rewritten so they assume no gender. Deliberately few: each is
 * a fixed phrase whose neutral form says the same thing.
 */
export function neutralFrench(text: string): string {
  let out = text;
  for (const [re, to] of NEUTRAL) out = out.replace(re, to as (substring: string, ...args: string[]) => string);
  return out;
}

export function selfGender(texts: string[]): "m" | "f" | null {
  let m = 0;
  let f = 0;
  for (const raw of texts) {
    const s = raw.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
    // Written with both forms on purpose ("allé(e)", "prêt·e"): no reading.
    if (/[a-zàâçéèêëîïôûùüÿœ]\((?:e|es)\)|[a-zàâçéèêëîïôûùüÿœ]·e(?![a-z])/.test(s)) continue;
    m += [...s.matchAll(MASC_E)].length;
    f += [...s.matchAll(FEM_E)].length;
    for (const [mas, fem] of PAIR_RES) {
      if (fem.test(s)) f++;
      else if (mas.test(s)) m++;
    }
  }
  if (m > 0 && f === 0) return "m";
  if (f > 0 && m === 0) return "f";
  if (m >= 3 * f && m > 0) return "m";
  if (f >= 3 * m && f > 0) return "f";
  return null;
}
