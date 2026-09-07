import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { AssistantChat } from "@/components/app/assistant-chat";
import { getProfile } from "@/lib/user/profile";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Assistant" };

export default async function AssistantPage() {
  const [{ firstName }, m] = await Promise.all([getProfile(), getMessages()]);
  return (
    <>
      <PageHeader title={m.pages.assistant.title} description={m.pages.assistant.desc} />
      <AssistantChat firstName={firstName} />
    </>
  );
}
