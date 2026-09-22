import { NotionClient } from "./client";
import { selectBlueprints } from "./blueprint";
import type { GenerationStep } from "./phases";
import type { AreaId } from "@/lib/onboarding";

export interface GenerationEvent {
  step: GenerationStep | "done";
  progress: number; // 0..1
  /** The database being created, during the `databases` step. */
  db?: string;
}

/** What the generator needs to know about the person. */
export interface GenerationInput {
  name: string | null;
  areas: readonly AreaId[];
}

export interface WorkspaceManifest {
  rootPageId: string;
  databases: { key: string; id: string; url: string }[];
  createdAt: string;
}

/**
 * Orchestrates a full workspace build against the Notion API.
 * Deterministic order, emits progress for the UI.
 *
 * Not idempotent: every run creates a fresh set of databases. The caller is
 * responsible for not running it twice by accident.
 *
 * Relations are wired in a second pass because a relation property needs its
 * target database to already exist.
 */
export async function generateWorkspace(opts: {
  token: string;
  rootPageId: string;
  person: GenerationInput;
  onProgress?: (e: GenerationEvent) => void;
}): Promise<WorkspaceManifest> {
  const { token, rootPageId, person, onProgress } = opts;
  const notion = new NotionClient(token);
  const emit = (step: GenerationEvent["step"], progress: number, db?: string) =>
    onProgress?.({ step, progress, db });

  emit("verify", 0.05);
  await notion.me();

  const plan = selectBlueprints(person.areas);
  const idByKey = new Map<string, string>();
  const databases: WorkspaceManifest["databases"] = [];

  // Pass 1 — create databases without relation properties.
  for (let i = 0; i < plan.length; i++) {
    const bp = plan[i];
    emit("databases", 0.1 + (i / plan.length) * 0.4, bp.title);
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
  emit("relations", 0.55);
  for (const bp of plan) {
    if (!bp.relations) continue;
    const dbId = idByKey.get(bp.key)!;
    for (const rel of bp.relations) {
      const targetId = idByKey.get(rel.to);
      if (targetId) await notion.addRelation(dbId, rel.prop, targetId);
    }
  }

  emit("home", 0.7);
  await createHomeDashboard(notion, rootPageId, databases);

  emit("seed", 0.85);
  await seedStarters(notion, idByKey, person);

  const manifest: WorkspaceManifest = {
    rootPageId,
    databases,
    createdAt: new Date().toISOString(),
  };
  emit("done", 1);
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
        heading_2: { rich_text: [{ text: { content: "Built by LifeOS" } }] },
      },
      {
        object: "block",
        type: "callout",
        callout: {
          icon: { emoji: "✨" },
          // Said "Linked views appear below" — no views were ever created.
          rich_text: [{ text: { content: "Your databases sit alongside this page, in the page you shared with LifeOS." } }],
        },
      },
    ],
  });
}

async function seedStarters(
  notion: NotionClient,
  idByKey: Map<string, string>,
  person: GenerationInput
) {
  const projects = idByKey.get("projects");
  if (projects) {
    await notion.createPage({
      parent: { database_id: projects },
      properties: {
        Name: { title: [{ text: { content: person.name ? `Welcome, ${person.name} 👋` : "Welcome 👋" } }] },
        Status: { select: { name: "In progress" } },
        Priority: { select: { name: "High" } },
      },
    });
  }
}
