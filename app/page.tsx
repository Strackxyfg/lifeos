import type { Metadata } from "next";
import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Features } from "@/components/landing/features";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await getMessages()).landing.meta;
  return {
    title: { absolute: t.title },
    description: t.description,
    openGraph: { title: t.title, description: t.description },
    twitter: { title: t.title, description: t.description },
  };
}

export default async function HomePage() {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <LocaleProvider locale={locale} messages={messages}>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </LocaleProvider>
  );
}
