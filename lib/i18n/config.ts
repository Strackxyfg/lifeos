export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";
export const LOCALE_COOKIE = "lifeos_locale";

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (locales as readonly string[]).includes(v);
}

/** Tiny interpolation: t("Hi {name}", { name }) → "Hi Quinn". */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** A count-dependent string: `{ one: "{n} note", other: "{n} notes" }`. */
export interface Plural {
  one: string;
  other: string;
}

/**
 * Picks the right form for `n`, then fills `{n}`.
 *
 * Uses the language's own rules rather than `n === 1`: French treats 0 as
 * singular ("0 connexion") where English treats it as plural ("0
 * connections"). Hand-rolled checks get one of the two languages wrong.
 */
export function plural(locale: Locale, n: number, forms: Plural, vars: Record<string, string | number> = {}): string {
  const rule = new Intl.PluralRules(locale === "fr" ? "fr-FR" : "en-US").select(n);
  return fill(rule === "one" ? forms.one : forms.other, { n, ...vars });
}
