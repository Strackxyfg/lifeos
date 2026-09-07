import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { testimonials } from "@/lib/content/site";

export function Testimonials() {
  return (
    <Section>
      <Reveal>
        <SectionHeader
          eyebrow="Loved by operators"
          title="The setup people used to pay consultants for"
        />
      </Reveal>

      <RevealGroup className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-2">
        {testimonials.map((t) => (
          <RevealItem
            as="figure"
            key={t.name}
            className="flex flex-col justify-between rounded-xl border border-border bg-surface p-7"
          >
            <blockquote className="text-pretty text-[1.0625rem] leading-relaxed text-foreground/90">
              &ldquo;{t.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-6 flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-sm font-medium text-muted-foreground">
                {t.name.split(" ").map((n) => n[0]).join("")}
              </span>
              <span className="text-sm">
                <span className="font-medium">{t.name}</span>
                <span className="block text-muted-foreground">{t.role}</span>
              </span>
            </figcaption>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
