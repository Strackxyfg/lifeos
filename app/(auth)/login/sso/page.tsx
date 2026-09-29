import type { Metadata } from "next";
import { SsoForm } from "@/components/auth/sso-form";

export const metadata: Metadata = {
  title: "Single sign-on",
  robots: { index: false, follow: false },
};

export default async function SsoPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return <SsoForm next={next} error={error?.slice(0, 40)} />;
}
