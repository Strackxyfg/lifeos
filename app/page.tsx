import { Nav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { Logos } from "@/components/landing/logos";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Features } from "@/components/landing/features";
import { Databases } from "@/components/landing/databases";
import { Testimonials } from "@/components/landing/testimonials";
import { Pricing } from "@/components/landing/pricing";
import { Faq } from "@/components/landing/faq";
import { Waitlist } from "@/components/landing/waitlist";
import { Footer } from "@/components/landing/footer";
import { CommandMenu } from "@/components/command-menu";

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Logos />
        <Databases />
        <HowItWorks />
        <Features />
        <Testimonials />
        <Pricing />
        <Faq />
        <Waitlist />
      </main>
      <Footer />
      <CommandMenu />
    </>
  );
}
