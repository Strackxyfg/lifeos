import type { Metadata } from "next";
import { Hub } from "@/components/hub/hub";
import { getMessages } from "@/lib/i18n/server";
import { getProfile } from "@/lib/user/profile";
import { buildAlerts } from "@/lib/data/alerts";
import { loadHubFacts } from "@/lib/hub/load";

export const metadata: Metadata = { title: "Hub" };

export default async function HubPage() {
  const m = await getMessages();
  const [profile, alerts, facts] = await Promise.all([getProfile(), buildAlerts(m), loadHubFacts(m)]);
  return <Hub facts={facts} profile={profile} alerts={alerts} />;
}
