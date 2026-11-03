import { requireUserKey } from "@/lib/auth/require-user";
import { locked } from "@/lib/plans/server";
import { salesJournal } from "@/lib/sales/journal";
import { parisToday } from "@/lib/sales/overview";
import { getSalesStore } from "@/lib/sales/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The sales journal of a year as a CSV file for the accountant
 * (`?year=2026`, this year by default) — `lib/sales/journal.ts`.
 *
 * API routes are outside the middleware matcher: identity, edition and
 * migration are checked here, with the strict helper.
 */
export async function GET(req: Request) {
  const auth = await requireUserKey();
  if ("response" in auth) return auth.response;
  if (await locked("invoicing")) return Response.json({ error: "edition" }, { status: 403 });
  const store = getSalesStore();
  if (!(await store.supports())) return Response.json({ error: "migration_pending" }, { status: 409 });

  const asked = new URL(req.url).searchParams.get("year");
  const year = asked && /^\d{4}$/.test(asked) ? Number(asked) : Number(parisToday().slice(0, 4));
  if (year < 2000 || year > 2999) return Response.json({ error: "invalid" }, { status: 400 });

  const { filename, csv } = salesJournal(await store.listDocs(auth.userKey), year);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
