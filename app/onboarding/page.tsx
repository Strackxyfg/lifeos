import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/onboarding/wizard";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { getProfile } from "@/lib/user/profile";

export const metadata: Metadata = {
  title: "Get started",
  robots: { index: false, follow: false },
};

/**
 * Builds the person's second brain from seven questions.
 *
 * There is no Notion step any more. It used to come first and gate
 * everything; now nothing here depends on a third party, and Notion is an
 * optional export from Settings.
 *
 * On a second visit the profile pre-fills name, work and areas. Goals are
 * not pre-filled: they live in the brain, and re-submitting one that already
 * exists reuses the note rather than duplicating it.
 */
export default async function OnboardingPage() {
  const [locale, messages, profile] = await Promise.all([getLocale(), getMessages(), getProfile()]);

  return (
    <LocaleProvider locale={locale} messages={messages}>
      <OnboardingWizard
        initial={{
          name: profile.name === "there" ? "" : profile.name,
          profession: profile.profession ?? "",
          areas: profile.areas,
        }}
      />
    </LocaleProvider>
  );
}
