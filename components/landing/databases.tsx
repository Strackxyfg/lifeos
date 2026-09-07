import { Section, SectionHeader } from "@/components/ui/section";
import { Reveal, RevealGroup, RevealItem } from "@/components/ui/reveal";
import { databases } from "@/lib/content/site";

export function Databases() {
  return (
    <Section id="product">
      <Reveal>
        <SectionHeader
          eyebrow="What gets built"
          title="Ten interconnected databases, wired together"
          description="Projects link to tasks, tasks to goals, goals to your week. LifeOS generates the relations and rollups that take experts days."
        />
      </Reveal>

      <RevealGroup className="mt-16 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {databases.map((db) => (
          <RevealItem
            key={db.name}
            className="group flex items-start gap-4 rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted-foreground transition-colors group-hover:text-accent">
              <db.icon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-medium tracking-tight">{db.name}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{db.desc}</p>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}
