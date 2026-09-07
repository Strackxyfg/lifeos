import { NotionClient } from "./client";
import { selectBlueprints } from "./blueprint";
import type { OnboardingAnswers } from "@/lib/onboarding";

export type GenerationStep =
  | "verify" | "databases" | "relations" | "dashboards"
  | "templates" | "automations" | "seed" | "assistant" | "done";

export interface GenerationEvent {
  step: GenerationStep;
  label: string;
  progress: number; // 0..1
}

export interface WorkspaceManifest {
  rootPageId: string;
  databases: { key: string; id: string; url: string }[];
  createdAt: string;
}

/**
 * Orchestrates a full workspace build against the Notion API.
 * Deterministic order, idempotent-friendly, emits progress for the UI.
 *
 * Relations are wired in a second pass because a relation property needs its
 * target database to already exist.
 */
export async function generateWorkspace(opts: {
  token: string;
  rootPageId: string;
  answers: Partial<OnboardingAnswers>;
  onProgress?: (e: GenerationEvent) => void;
}): Promise<WorkspaceManifest> {
  const { token, rootPageId, answers, onProgress } = opts;
  const notion = new NotionClient(token);
  const emit = (step: GenerationStep, label: string, progress: number) =>
    onProgress?.({ step, label, progress });

  emit("verify", "Verifying access", 0.05);
  await notion.me();

  const plan = selectBlueprints(answers);
  const idByKey = new Map<string, string>();
  const databases: WorkspaceManifest["databases"] = [];

  // Pass 1 — create databases without relation properties.
  for (let i = 0; i < plan.length; i++) {
    const bp = plan[i];
    emit("databases", `Creating ${bp.title}`, 0.1 + (i / plan.length) * 0.4);
    // Relation properties live on `bp.relations` and are added in pass 2,
    // once every target database exists.
    const created = await notion.createDatabase({
      parentPageId: rootPageId,
      title: bp.title,
      icon: bp.icon,
      properties: bp.properties,
    });
    idByKey.set(bp.key, created.id);
    databases.push({ key: bp.key, id: created.id, url: created.url });
  }

  // Pass 2 — wire relations now that all targets exist.
  emit("relations", "Wiring relations & rollups", 0.55);
  for (const bp of plan) {
    if (!bp.relations) continue;
    const dbId = idByKey.get(bp.key)!;
    for (const rel of bp.relations) {
      const targetId = idByKey.get(rel.to);
      if (targetId) await notion.addRelation(dbId, rel.prop, targetId);
    }
  }

  emit("dashboards", "Composing dashboards", 0.7);
  await createHomeDashboard(notion, rootPageId, databases);

  emit("seed", "Adding starter content", 0.85);
  await seedStarters(notion, idByKey, answers);

  emit("assistant", "Training your assistant", 0.95);
  // Persist manifest + assistant config in Supabase (handled by caller).

  const manifest: WorkspaceManifest = {
    rootPageId,
    databases,
    createdAt: new Date().toISOString(),
  };
  emit("done", "Your workspace is ready", 1);
  return manifest;
}

async function createHomeDashboard(
  notion: NotionClient,
  rootPageId: string,
  databases: WorkspaceManifest["databases"]
) {
  await notion.createPage({
    parent: { page_id: rootPageId },
    icon: "🏠",
    properties: { title: { title: [{ text: { content: "🏠 Home" } }] } },
    children: [
      {
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ text: { content: "This week" } }] },
      },
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { emoji: "✨" },
          rich_text: [{ text: { content: "Your LifeOS is live. Linked views appear below." } }],
        },
      },
    ],
  });
}

async function seedStarters(
  notion: NotionClient,
  idByKey: Map<string, string>,
  answers: Partial<OnboardingAnswers>
) {
  const projects = idByKey.get("projects");
  if (projects) {
    await notion.createPage({
      parent: { database_id: projects },
      properties: {
        Name: { title: [{ text: { content: `Welcome, ${answers.name ?? "there"} 👋` } }] },
        Status: { select: { name: "In progress" } },
        Priority: { select: { name: "High" } },
      },
    });
  }
}
