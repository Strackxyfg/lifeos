/**
 * LifeOS Agent Readiness Assessment.
 *
 * Two clearly-separated modules — the distinction matters, and the UI states it:
 *
 *  1. `bigfive` — the **Mini-IPIP** (Donnellan, Oswald, Baird & Lucas, 2006),
 *     a 20-item public-domain Big Five measure drawn from the International
 *     Personality Item Pool. Published internal consistency α ≈ .65–.77 and
 *     convergence r ≈ .85–.93 with the 50-item parent scales.
 *
 *  2. `calibration` — purpose-built operational items about delegation, risk
 *     and communication. These are **not** a validated psychometric scale and
 *     are never presented as one; they exist because trait scores alone don't
 *     tell us how much autonomy someone actually wants.
 *
 * The output calibrates how the agent behaves. It is not a clinical assessment
 * and must never be used to judge a person.
 */

export type Domain = "O" | "C" | "E" | "A" | "N";
export type Module = "bigfive" | "calibration";

export interface Item {
  id: string;
  module: Module;
  /** Big Five domain, or an operational axis for calibration items. */
  facet: Domain | "autonomy" | "risk" | "comms";
  /** English + French wording. Both are shown in the user's locale. */
  en: string;
  fr: string;
  /** True when agreement indicates *less* of the trait. */
  reverse?: boolean;
}

/** 5-point Likert, 1 = very inaccurate … 5 = very accurate. */
export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;

/** Mini-IPIP — 20 items, 4 per domain. Public domain (IPIP). */
const bigFive: Item[] = [
  { id: "e1", module: "bigfive", facet: "E", en: "I am the life of the party.", fr: "Je suis l'âme de la fête." },
  { id: "e2", module: "bigfive", facet: "E", en: "I don't talk a lot.", fr: "Je ne parle pas beaucoup.", reverse: true },
  { id: "e3", module: "bigfive", facet: "E", en: "I talk to a lot of different people at parties.", fr: "Je parle à beaucoup de gens différents en soirée." },
  { id: "e4", module: "bigfive", facet: "E", en: "I keep in the background.", fr: "Je reste en retrait.", reverse: true },

  { id: "a1", module: "bigfive", facet: "A", en: "I sympathize with others' feelings.", fr: "Je compatis aux sentiments des autres." },
  { id: "a2", module: "bigfive", facet: "A", en: "I am not interested in other people's problems.", fr: "Les problèmes des autres ne m'intéressent pas.", reverse: true },
  { id: "a3", module: "bigfive", facet: "A", en: "I feel others' emotions.", fr: "Je ressens les émotions des autres." },
  { id: "a4", module: "bigfive", facet: "A", en: "I am not really interested in others.", fr: "Je ne m'intéresse pas vraiment aux autres.", reverse: true },

  { id: "c1", module: "bigfive", facet: "C", en: "I get chores done right away.", fr: "Je fais les tâches courantes tout de suite." },
  { id: "c2", module: "bigfive", facet: "C", en: "I often forget to put things back in their proper place.", fr: "J'oublie souvent de ranger les choses à leur place.", reverse: true },
  { id: "c3", module: "bigfive", facet: "C", en: "I like order.", fr: "J'aime l'ordre." },
  { id: "c4", module: "bigfive", facet: "C", en: "I make a mess of things.", fr: "Je mets le désordre.", reverse: true },

  { id: "n1", module: "bigfive", facet: "N", en: "I have frequent mood swings.", fr: "J'ai de fréquents changements d'humeur." },
  { id: "n2", module: "bigfive", facet: "N", en: "I am relaxed most of the time.", fr: "Je suis détendu(e) la plupart du temps.", reverse: true },
  { id: "n3", module: "bigfive", facet: "N", en: "I get upset easily.", fr: "Je me contrarie facilement." },
  { id: "n4", module: "bigfive", facet: "N", en: "I seldom feel blue.", fr: "J'ai rarement le cafard.", reverse: true },

  { id: "o1", module: "bigfive", facet: "O", en: "I have a vivid imagination.", fr: "J'ai une imagination vive." },
  { id: "o2", module: "bigfive", facet: "O", en: "I am not interested in abstract ideas.", fr: "Les idées abstraites ne m'intéressent pas.", reverse: true },
  { id: "o3", module: "bigfive", facet: "O", en: "I have difficulty understanding abstract ideas.", fr: "J'ai du mal à comprendre les idées abstraites.", reverse: true },
  { id: "o4", module: "bigfive", facet: "O", en: "I do not have a good imagination.", fr: "Je n'ai pas beaucoup d'imagination.", reverse: true },
];

/**
 * Operational calibration — purpose-built, NOT a validated scale.
 * These drive the agent's autonomy ceiling and approval thresholds.
 */
const calibration: Item[] = [
  { id: "au1", module: "calibration", facet: "autonomy", en: "I'd rather an assistant act and tell me after, than ask me first.", fr: "Je préfère qu'un assistant agisse puis me prévienne, plutôt qu'il me demande d'abord." },
  { id: "au2", module: "calibration", facet: "autonomy", en: "I want to review anything before it leaves my hands.", fr: "Je veux tout relire avant que ça sorte de chez moi.", reverse: true },
  { id: "au3", module: "calibration", facet: "autonomy", en: "Delegating work without checking it stresses me.", fr: "Déléguer sans vérifier me stresse.", reverse: true },
  { id: "au4", module: "calibration", facet: "autonomy", en: "I'm comfortable letting software make small decisions for me.", fr: "Je suis à l'aise pour laisser un logiciel prendre de petites décisions à ma place." },

  { id: "ri1", module: "calibration", facet: "risk", en: "A rare mistake is an acceptable price for speed.", fr: "Une erreur rare est un prix acceptable pour aller plus vite." },
  { id: "ri2", module: "calibration", facet: "risk", en: "I would rather something be late than wrong.", fr: "Je préfère que ce soit en retard plutôt que faux.", reverse: true },
  { id: "ri3", module: "calibration", facet: "risk", en: "I'm willing to let an assistant spend money on my behalf within a budget.", fr: "J'accepte qu'un assistant dépense en mon nom dans une limite définie." },
  { id: "ri4", module: "calibration", facet: "risk", en: "I want a hard confirmation before anything irreversible.", fr: "Je veux une confirmation ferme avant toute action irréversible.", reverse: true },

  { id: "co1", module: "calibration", facet: "comms", en: "Give me the conclusion first, details only if I ask.", fr: "Donnez-moi la conclusion d'abord, les détails seulement si je demande." },
  { id: "co2", module: "calibration", facet: "comms", en: "I want to see the reasoning behind every recommendation.", fr: "Je veux voir le raisonnement derrière chaque recommandation.", reverse: true },
  { id: "co3", module: "calibration", facet: "comms", en: "Frequent short updates suit me better than one long report.", fr: "Des points courts et fréquents me conviennent mieux qu'un long rapport." },
  { id: "co4", module: "calibration", facet: "comms", en: "I prefer to be left alone until something needs me.", fr: "Je préfère qu'on me laisse tranquille jusqu'à ce qu'on ait besoin de moi." },
];

export const items: Item[] = [...bigFive, ...calibration];

export const ITEM_COUNT = items.length;

/** Attention check: inserted mid-assessment to detect straight-lining. */
export const ATTENTION_CHECK: Item = {
  id: "chk1",
  module: "calibration",
  facet: "comms",
  en: 'Please select "Disagree" for this item so we know you are reading.',
  fr: 'Veuillez choisir « Plutôt faux » pour cet item, afin de vérifier votre attention.',
};

/** Expected Likert value for the attention check. */
export const ATTENTION_CHECK_EXPECTED = 2;
