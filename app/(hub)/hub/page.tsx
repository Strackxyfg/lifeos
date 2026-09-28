import type { Metadata } from "next";
import { Hub } from "@/components/hub/hub";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { getProfile } from "@/lib/user/profile";
import { buildAlerts } from "@/lib/data/alerts";
import { loadHubFacts } from "@/lib/hub/load";

export const metadata: Metadata = { title: "Hub" };

export default async function HubPage() {
  const [m, locale] = await Promise.all([getMessages(), getLocale()]);
  const [profile, alerts, facts] = await Promise.all([getProfile(), buildAlerts(m, locale), loadHubFacts(m)]);
  return <Hub facts={facts} profile={profile} alerts={alerts} />;
}
