import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ShareCapture } from "@/components/brain/share-capture";
import { composeShared } from "@/lib/brain/share";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Capture", robots: { index: false, follow: false } };

/**
 * The share target: installed on a phone, LifeOS appears in the system's
 * share sheet, and what is shared lands here to be confirmed. See `app/manifest.ts`.
 */
export default async function SharePage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string | string[]; text?: string | string[]; url?: string | string[] }>;
}) {
  const [m, sp] = await Promise.all([getMessages(), searchParams]);
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const shared = composeShared({ title: first(sp.title), text: first(sp.text), url: first(sp.url) });

  return (
    <>
      <PageHeader title={m.share.title} description={m.share.desc} />
      <ShareCapture shared={shared} />
    </>
  );
}
