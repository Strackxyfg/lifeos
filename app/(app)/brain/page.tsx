import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { SecondBrain } from "@/components/brain/second-brain";
import { getMessages } from "@/lib/i18n/server";
import { loadCollection } from "@/lib/data/live";

export const metadata: Metadata = { title: "Second Brain" };

export default async function BrainPage() {
  const [m, items] = await Promise.all([getMessages(), loadCollection("brain")]);
  return (
    <>
      <PageHeader title={m.pages.brain.title} description={m.pages.brain.desc} />
      <SecondBrain items={items} />
    </>
  );
}
