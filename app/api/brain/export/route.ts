import { getAuthenticatedUserKey, getStore } from "@/lib/db/store";
import { extensionForMime } from "@/lib/db/audio-files";
import { ZipWriter } from "@/lib/export/zip";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { loadBrainView } from "@/lib/brain/load";
import { toJson, toMarkdown, type MarkdownLabels } from "@/lib/brain/export";
import { CATEGORY_IDS } from "@/lib/data/brain";
import { plural } from "@/lib/i18n/config";
import { relationText } from "@/lib/brain/labels";
import { loadWorkspaceExport } from "@/lib/export/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads the whole second brain — `?format=md` (default), `?format=json`,
 * or `?format=zip`: both, with every recording and its word-by-word
 * transcript, the Markdown linking each voice note to its audio. The archive
 * is streamed file by file, so a brain with many recordings neither fills
 * memory nor meets a serverless response's size limit. JSON and ZIP also
 * carry the rest of what the person keeps here — profile, projects, deals,
 * finances, reminders, reviews, and what they wrote in their teams
 * (lib/export/workspace.ts) — so "complete" is true; Markdown is the brain.
 *
 * API routes are outside the middleware matcher, so this checks identity
 * itself, and with the strict helper: `getUserKey()` would fall back to the
 * shared demo key and happily export the demo brain to anyone.
 */
export async function GET(req: Request) {
  const userKey = await getAuthenticatedUserKey();
  if (!userKey) return new Response("Unauthorized", { status: 401 });

  const asked = new URL(req.url).searchParams.get("format");
  const format = asked === "json" || asked === "zip" ? asked : "md";
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
    // "Complete" means complete: the brain, and everything else the person keeps here.
    const complete = { ...toJson(notes, links, now), workspace: await loadWorkspaceExport(userKey) };
    return new Response(JSON.stringify(complete, null, 2), {
      headers: {
        ...headers,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${stem}-${day}.json"`,
      },
    });
  }

  const markdownLabels: MarkdownLabels = {
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
    recording: locale === "fr" ? "Enregistrement" : "Recording",
  };

  if (format === "zip") {
    const store = getStore();
    const recordings = (await store.supportsVoice()) ? await store.list(userKey, "audio") : [];
    const folder = locale === "fr" ? "enregistrements" : "recordings";
    const pathOf = new Map(recordings.map((r) => [r.id, `${folder}/${r.id}.${extensionForMime(r.mime)}`]));
    const workspace = await loadWorkspaceExport(userKey);
    const encoder = new TextEncoder();
    const zip = new ZipWriter();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const emit = (chunks: Uint8Array[]) => chunks.forEach((c) => controller.enqueue(c));
          emit(zip.file(`${stem}.md`, encoder.encode(toMarkdown(notes, links, markdownLabels, now, (id) => pathOf.get(id) ?? null)), now));
          emit(zip.file(`${stem}.json`, encoder.encode(JSON.stringify(toJson(notes, links, now), null, 2)), now));
          // Profile, projects, deals, finances, reminders, reviews, and what was written in teams.
          emit(zip.file(locale === "fr" ? "espace-de-travail.json" : "workspace.json", encoder.encode(JSON.stringify(workspace, null, 2)), now));
          // One recording at a time: read, written, released.
          for (const r of recordings) {
            const audio = await store.getAudio(userKey, r.path);
            if (!audio) continue;
            const created = new Date(r.createdAt);
            emit(zip.file(pathOf.get(r.id)!, audio, created));
            const transcript = { id: r.id, createdAt: r.createdAt, mime: r.mime, durationMs: r.durationMs, language: r.language, words: r.transcript };
            emit(zip.file(`${folder}/${r.id}.json`, encoder.encode(JSON.stringify(transcript, null, 2)), created));
          }
          controller.enqueue(zip.finish());
          controller.close();
        } catch (err) {
          console.error("[export] archive failed", err);
          controller.error(err);
        }
      },
    });
    return new Response(body, {
      headers: {
        ...headers,
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${stem}-${day}.zip"`,
      },
    });
  }

  const md = toMarkdown(notes, links, markdownLabels, now);

  return new Response(md, {
    headers: {
      ...headers,
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${stem}-${day}.md"`,
    },
  });
}
