import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { DocEditor } from "@/components/sales/doc-editor";
import { DocView } from "@/components/sales/doc-view";
import { getUserKey } from "@/lib/db/store";
import { getMessages } from "@/lib/i18n/server";
import { statusOf } from "@/lib/sales/legal";
import { parisToday } from "@/lib/sales/overview";
import { getSalesStore } from "@/lib/sales/store";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const [m, { id }] = await Promise.all([getMessages(), params]);
  const store = getSalesStore();
  const doc = (await store.supports()) ? await store.getDoc(await getUserKey(), id).catch(() => null) : null;
  return { title: doc ? (doc.number ?? m.sales.kinds[doc.kind]) : m.sales.title };
}

export default async function SalesDocPage({ params }: { params: Promise<{ id: string }> }) {
  const [m, { id }] = await Promise.all([getMessages(), params]);
  const store = getSalesStore();
  if (!(await store.supports())) {
    return (
      <>
        <PageHeader title={m.sales.title} />
        <p className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-[0.875rem] leading-relaxed">{m.sales.pending}</p>
      </>
    );
  }
  const userKey = await getUserKey();
  const doc = await store.getDoc(userKey, id);
  if (!doc) notFound();

  if (doc.number === null) {
    const [issuer, clients, catalog] = await Promise.all([store.getIssuer(userKey), store.listClients(userKey), store.listCatalog(userKey)]);
    return <DocEditor doc={doc} issuer={issuer} clients={clients} catalog={catalog.filter((c) => !c.archived)} />;
  }

  // What came from this document: the invoice made from a quote, the credit notes on an invoice.
  const followUps = (await store.listDocs(userKey))
    .filter((d) => d.content.relatedId === doc.id)
    .map((d) => ({ id: d.id, kind: d.kind, number: d.number }));
  const today = parisToday();
  return <DocView doc={doc} status={statusOf(doc, today)} followUps={followUps} today={today} />;
}
