import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ProjectsView } from "@/components/app/projects-view";
import { QuickAdd } from "@/components/app/quick-add";
import { createProject } from "@/app/actions/workspace";
import { loadCollection } from "@/lib/data/live";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const [m, projects] = await Promise.all([getMessages(), loadCollection("projects")]);

  return (
    <>
      <PageHeader
        title={m.pages.projects.title}
        description={m.pages.projects.desc}
        action={
          <QuickAdd
            triggerLabel={m.common.newProject}
            title={m.common.newProject}
            submitLabel={m.form.create}
            successMessage={m.form.savedProject}
            action={createProject}
            fields={[
              { name: "name", label: m.form.name, required: true, wide: true, placeholder: "…" },
              {
                name: "status",
                label: m.form.status,
                type: "select",
                defaultValue: "Planning",
                options: (["Planning", "In progress", "Blocked", "Done"] as const).map((v) => ({
                  value: v,
                  label: m.labels[v],
                })),
              },
              {
                name: "priority",
                label: m.form.priority,
                type: "select",
                defaultValue: "Medium",
                options: (["Low", "Medium", "High"] as const).map((v) => ({
                  value: v,
                  label: m.labels[v],
                })),
              },
              { name: "owner", label: m.form.owner },
              { name: "due", label: m.form.due, placeholder: "Aug 12" },
              { name: "progress", label: m.form.progress, type: "number", defaultValue: "0" },
            ]}
          />
        }
      />
      <ProjectsView projects={projects} />
    </>
  );
}
