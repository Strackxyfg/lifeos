import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { AssistantChat } from "@/components/app/assistant-chat";
import { AgentThread } from "@/components/assistant/agent-thread";
import { aiAvailable } from "@/lib/ai/router";
import { includes } from "@/lib/plans/editions";
import { getProfile } from "@/lib/user/profile";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Assistant" };

/**
 * The agent, when a model is configured: it looks things up, acts, and asks
 * before anything leaves LifeOS. Without one, the assistant that says so and
 * shows what the brain already holds.
 */
export default async function AssistantPage() {
  const [{ firstName, edition }, m] = await Promise.all([getProfile(), getMessages()]);
  return (
    <>
      <PageHeader title={m.pages.assistant.title} description={m.pages.assistant.desc} />
      {aiAvailable() ? <AgentThread firstName={firstName} business={includes(edition, "agent.business")} /> : <AssistantChat firstName={firstName} />}
    </>
  );
}
