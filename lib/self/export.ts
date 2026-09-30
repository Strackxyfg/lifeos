import { DIMENSIONS, type Dimension, type Portrait } from "./portrait";

/**
 * The portrait as a document the person can read anywhere: each trait, its
 * state (confirmed, theirs, or still to confirm), and the words of theirs it
 * rests on. Part of the complete export; the raw rows (with check-ins and
 * what they did with advice) go in the workspace JSON beside it.
 */

export interface PortraitLabels {
  title: string;
  exportedOn: string;
  dimension: Record<Dimension, string>;
  confirmed: string;
  proposed: string;
  yours: string;
  empty: string;
}

const quoted = (s: string, fr: boolean) => (fr ? `« ${s} »` : `“${s}”`);

export function portraitMarkdown(portrait: Portrait, labels: PortraitLabels, now: Date, locale: "fr" | "en"): string {
  const fr = locale === "fr";
  const lines = [`# ${labels.title}`, "", `_${labels.exportedOn} ${now.toISOString().slice(0, 10)}_`, ""];
  let any = false;
  for (const d of DIMENSIONS) {
    const traits = portrait[d];
    if (traits.length === 0) continue;
    any = true;
    lines.push(`## ${labels.dimension[d]}`, "");
    for (const t of traits) {
      const state = t.status === "proposed" ? labels.proposed : t.origin === "person" ? labels.yours : labels.confirmed;
      lines.push(`- ${t.statement} — _${state}_`);
      for (const q of t.quotes) lines.push(`  > ${quoted(q.quote, fr)} — ${q.title}`);
    }
    lines.push("");
  }
  if (!any) lines.push(labels.empty, "");
  return lines.join("\n");
}
