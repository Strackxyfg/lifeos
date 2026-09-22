import { getAuthenticatedUserKey } from "@/lib/db/store";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { loadBrainView } from "@/lib/brain/load";
import { toJson, toMarkdown } from "@/lib/brain/export";
import { CATEGORY_IDS } from "@/lib/data/brain";
import { plural } from "@/lib/i18n/config";
import { relationText } from "@/lib/brain/labels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads the whole second brain — `?format=md` (default) or `?format=json`.
 *
 * API routes are outside the middleware matcher, so this checks identity
 * itself, and with the strict helper: `getUserKey()` would fall back to the
 * shared demo key and happily export the demo brain to anyone.
 */
export async function GET(req: Request) {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return new Response("Unauthorized", { status: 401 });

  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  const { notes, links } = await loadBrainView(m);
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const stem = locale === "fr" ? "lifeos-second-cerveau" : "lifeos-second-brain";

  const headers = {
    // Personal data: never cached by a browser, proxy or CDN.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };

  if (format === "json") {
    return new Response(JSON.stringify(toJson(notes, links, now), null, 2), {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem}-${day}.json"`,
      },
    });
  }

  const md = toMarkdown(
    notes,
    links,
    {
      title: m.nav.brain,
      exportedOn: locale === "fr" ? "Exporté le" : "Exported on",
      counts: (n, l) =>
        `${plural(locale, n, m.brain.hudNotes)} · ${plural(locale, l, m.brain.hudLinks)}`,
      region: Object.fromEntries(CATEGORY_IDS.map((c) => [c, m.brain.cat[c].label])) as Record<
        (typeof CATEGORY_IDS)[number],
        string
      >,
      // A narrow no-break space before the colon, as French typography wants.
      linkedTo: locale === "fr" ? `${m.brain.links.title} :` : `${m.brain.links.title}:`,
      done: m.brain.note.done,
      todo: locale === "fr" ? "à faire" : "to do",
      relation: (kind, side) => relationText(kind, side, m).toLowerCase(),
    },
    now
  );

  return new Response(md, {
    headers: {
      ...headers,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stem}-${day}.md"`,
    },
  });
}
