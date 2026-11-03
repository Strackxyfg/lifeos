import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { AssistantChat } from "@/components/app/assistant-chat";
import { AgentThread } from "@/components/assistant/agent-thread";
import { aiAvailable } from "@/lib/ai/router";
import { includes } from "@/lib/plans/editions";
import { getProfile } from "@/lib/user/profile";
import { getMessages } from "@/lib/i18n/server";
import { getUserKey } from "@/lib/db/store";
import { locked } from "@/lib/plans/server";
import { getSpecialistStore } from "@/lib/specialists/store";

export const metadata: Metadata = { title: "Assistant" };

/**
 * The agent, when a model is configured: it looks things up, acts, and asks
 * before anything leaves LifeOS. Without one, the assistant that says so and
 * shows what the brain already holds.
 */
/** The owner's specialists, for the conversation's selector — none before migration 018 or without the agent. */
async function specialistChoices() {
  if (await locked("agent")) return [];
  const store = getSpecialistStore();
  if (!(await store.supports().catch(() => false))) return [];
  return (await store.list(await getUserKey())).map((s) => ({ id: s.id, name: s.name, description: s.description }));
}

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ specialist?: string }> }) {
  const [{ firstName, edition }, m, specialists, { specialist }] = await Promise.all([getProfile(), getMessages(), specialistChoices(), searchParams]);
  return (
    <>
      <PageHeader title={m.pages.assistant.title} description={m.pages.assistant.desc} />
      {aiAvailable() ? (
        <AgentThread firstName={firstName} business={includes(edition, "agent.business")} specialists={specialists} initialSpecialist={specialist ?? null} />
      ) : (
        <AssistantChat firstName={firstName} />
      )}
    </>
  );
}
