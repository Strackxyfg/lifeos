/**
 * What someone writes to their double can be heavy. Two levels are read
 * from the words themselves, in French and English, without a model — so
 * the answer to them never depends on one being up:
 *
 *  - "distress": they are going through something hard (exhausted, anxious,
 *    "je n'en peux plus", feeling worthless…). The double slows down and
 *    receives it before anything else.
 *  - "crisis": they may be thinking of ending their life or hurting
 *    themselves. The double puts their safety first, and the page shows
 *    who to call, whatever the model says or whether it answers at all.
 *
 * Idioms that only sound alike ("se tuer à la tâche", "ça me tue",
 * "this deadline is killing me", "en finir avec ce dossier") are not read
 * as a crisis. When in doubt the reading leans towards care: showing a
 * helpline to someone who did not need it costs little; missing someone
 * who did costs everything.
 */

export type Care = "none" | "distress" | "crisis";

/** Lower case, no accents, straight apostrophes, single spaces. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, " ");
}

/** Things — a project, a file — one can "en finir avec" without any danger. */
const THING = "(?:ce|cet|cette|ces|le|la|les|l'|mon|ma|mes|ton|ta|tes|son|sa|ses|un|une|des|du|notre|nos|votre|vos|leur|leurs)\\b";

const CRISIS: RegExp[] = [
  // French
  /suicid/,
  /\b(?:je vais|je veux|je voudrais|j'ai envie de|j'aimerais|je pourrais|je pense a|penser a|envie de|besoin de|je vais finir par) me (?:tuer|suicider)\b(?! (?:a la tache|au travail|a la peine|de rire))/,
  /\bme foutre en l'air\b/,
  /\bmettre fin a (?:mes jours|ma vie|tout)\b/,
  new RegExp(`(?:\\b(?:veux|voudrais|veut|vais|aimerais|prefere|prefererais) |\\b(?:envie|besoin) d')en finir\\b(?! avec ${THING})`),
  /\ben finir avec (?:la vie|ma vie|tout|moi|mes jours)\b/,
  /\b(?:plus|pas|aucune) envie de vivre\b/,
  /\b(?:ne )?(?:veux|voudrais|veut) plus vivre\b/,
  /\bplus (?:la force|le courage) de vivre\b/,
  /\b(?:envie|besoin) de mourir\b/,
  /\b(?:je veux|j'aimerais|je voudrais|j'ai envie de) mourir\b/,
  /\b(?:voudrais|veux|aimerais|prefererais) (?:etre (?:mort|morte)|ne plus etre la)\b/,
  /\bme faire du mal\b/,
  /\bme (?:scarifier|mutiler)\b|\bscarif/,
  /\bne plus (?:me )?reveiller\b/,
  /\bdisparaitre (?:pour toujours|a jamais|definitivement)\b/,
  /\bpersonne ne (?:me regretterait|remarquerait si je)\b/,
  /\bsurdose\b|\boverdose\b/,
  // English
  /\bkill(?:ing)? myself\b/,
  /\bend (?:my life|it all)\b/,
  /\btake my (?:own )?life\b/,
  /\b(?:want|wanna) to die\b/,
  /\bwish i (?:was|were) dead\b/,
  /\bbetter off dead\b/,
  /\b(?:don't|do not|dont) want to (?:live|be alive|wake up|exist)\b/,
  /\bno (?:reason|point) (?:to live|in living)\b/,
  /\b(?:hurt(?:ing)?|harm(?:ing)?|cut(?:ting)?) myself\b/,
  /\bself[- ]?harm/,
];

const DISTRESS: RegExp[] = [
  // French
  /\bje (?:me sens|suis) (?:(?:tres|vraiment|tellement|si|completement|super) )?(?:mal|vide|nul|nulle|perdu|perdue|seul|seule|epuise|epuisee|a bout|deprime|deprimee|au bout|a plat|vide|brise|brisee|detruit|detruite|angoisse|angoissee|paume|paumee|submerge|submergee|deborde|debordee)\b/,
  /\b(?:je n'en peux plus|j'en peux plus|je n'en peux vraiment plus|je craque|je sature|j'y arrive plus|je n'y arrive plus|je n'arrive plus a rien|je n'arrive plus a avancer)\b/,
  /\b(?:a bout|au bout du rouleau|a bout de nerfs)\b/,
  /\bangoiss|\banxi(?:ete|eux|euse)\b|\bcrise d'angoisse|\bpanique\b/,
  /\bdepression\b|\bdeprim|\bburn[- ]?out\b|\bepuisement\b/,
  /\bje pleure\b|\bpleurer (?:tout le temps|sans arret|tous les soirs)\b/,
  /\bmal[- ]etre\b|\bsans espoir\b|\bdesespoir\b|\bdesespere/,
  /\b(?:je rate tout|tout rater|je gache tout|je decois tout le monde|decevoir tout le monde|je suis un echec|je ne vaux rien|je suis nul|je suis nulle)\b/,
  /\bsolitude\b|\bje me sens seul/,
  /\bje dors plus\b|\bje ne dors plus\b|\bje n'arrive plus a dormir\b/,
  // English
  /\bdepress(?:ed|ion)\b|\banxi(?:ous|ety)\b|\bpanic attack/,
  /\bburn(?:ed|t)?[- ]?out\b|\bexhausted\b|\boverwhelmed\b/,
  /\bcan(?:'t|not) (?:cope|take it|go on|do this anymore|sleep)\b/,
  /\bhopeless\b|\bworthless\b|\bempty inside\b|\blonely\b|\bi keep crying\b|\bi'm crying\b/,
  /\bi feel (?:awful|terrible|like a failure|lost|so alone|alone|broken|numb)\b/,
  /\bi (?:fail|ruin|mess up) everything\b/,
];

/** The level of care what they wrote calls for. */
export function careLevel(text: string): Care {
  const s = normalize(text);
  if (!s.trim()) return "none";
  if (CRISIS.some((r) => r.test(s))) return "crisis";
  if (DISTRESS.some((r) => r.test(s))) return "distress";
  return "none";
}

const RANK: Record<Care, number> = { none: 0, distress: 1, crisis: 2 };

/**
 * The care a conversation calls for: the gravest of their last two messages
 * — a crisis said a moment ago is not over because the next message is short.
 */
export function careOf(userMessages: string[]): Care {
  let worst: Care = "none";
  for (const m of userMessages.slice(-2)) {
    const c = careLevel(m);
    if (RANK[c] > RANK[worst]) worst = c;
  }
  return worst;
}
