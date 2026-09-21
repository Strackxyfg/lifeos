/**
 * Text handling shared by search and link suggestion.
 *
 * Accent-insensitive throughout. A French user types "evenement" as often as
 * "événement", and a second brain that cannot find its own notes because of a
 * missing accent is not one anyone keeps using.
 */

/** Lowercase, accents stripped. "Événement" → "evenement". */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Words that carry no meaning on their own, in both languages the product
 * ships in. Without this, two notes would be "related" because both contain
 * "pour" or "with".
 */
const STOP = new Set(
  (
    // French
    "les des une dans pour par sur avec sans sous chez vers entre mais donc car " +
    "que qui quoi dont est sont ete etre avoir fait faire plus moins tres bien " +
    "tout tous toute toutes cette ces ceux celle aux leur leurs notre nos votre " +
    "vos mon mes ton tes son ses elle elles ils nous vous comme aussi encore " +
    "deja alors ainsi quand puis peut faut autre autres meme lui " +
    "avant apres pendant depuis chaque plusieurs beaucoup trop peu surtout " +
    "vraiment toujours jamais souvent rien quelque quelques veut veulent " +
    "vouloir dois doit devoir pouvoir peux vais vont chose choses besoin " +
    // Question words: a question asked of the brain is compared against notes,
    // and "comment" would otherwise match every note that happens to use it.
    "comment pourquoi quel quelle quels quelles combien ou quoi est-ce " +
    // English
    "the and for with without from into onto about this that these those " +
    "was were are been being have has had does did will would should could " +
    "can may might must not but you your our their them they his her its " +
    "what which who whom when where why how all any some more most such only " +
    "own same than too very just also then there here before after during " +
    "since each several many much really always never often nothing " +
    "something want wants need needs thing things get got make made going " +
    "like well good one two three first second last next new per via yet still " +
    "upon every another other"
  ).split(" ")
);

/**
 * Plural folding, applied identically on both sides of every comparison so
 * "campagne" and "campagnes" match. Deliberately crude: consistency matters
 * more than linguistic accuracy, and "ss" endings are left alone so
 * "process" and "business" survive intact.
 */
function fold(word: string): string {
  if (word.length >= 5 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export interface Word {
  /** Normalised and folded — what comparisons use. "etude". */
  key: string;
  /** As the person wrote it, lowercased — what explanations show. "études". */
  surface: string;
}

/**
 * Meaningful words of a text, de-duplicated by key, in first-seen order.
 *
 * Both forms are kept because they serve different readers. Matching needs the
 * folded key so "campagnes" meets "campagne"; but the key is also shown to the
 * user as the reason two notes are related, and folding turns "LifeOS" into
 * "lifeo" and "temps" into "temp" — which reads as a bug. So explanations use
 * the surface form.
 */
export function words(s: string): Word[] {
  const out: Word[] = [];
  const seen = new Set<string>();
  for (const raw of s.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const base = normalize(raw);
    if (base.length < 3 || STOP.has(base) || /^\d+$/.test(base)) continue;
    const key = fold(base);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, surface: raw });
    }
  }
  return out;
}

/** Just the comparison keys. */
export function tokens(s: string): string[] {
  return words(s).map((w) => w.key);
}

/**
 * FNV-1a, 32-bit. Stable across runtimes and fast enough to call per node per
 * render — used wherever the product must be deterministic without storing
 * anything (a node's position in 3D, today's resurfaced note).
 */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
