import { planFromAnswers, type OnboardingAnswers } from "@/lib/onboarding";
import { genPhases, type GenStreamEvent } from "@/lib/notion/phases";
import { getNotionConnection } from "@/lib/notion/connection";
import { generateWorkspace } from "@/lib/notion/generate";
import { getUserKey } from "@/lib/db/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Streams the workspace build as Server-Sent Events.
 *
 * With Notion credentials it runs the real generator and streams its actual
 * progress — databases, relations and dashboards are written into Notion.
 * Without them it emits the same phase sequence as a **labelled simulation**
 * (`mode: "simulated"`), so the product demos end-to-end without pretending
 * anything was created.
 */
export async function POST(req: Request) {
  const answers = (await req.json().catch(() => ({}))) as Partial<OnboardingAnswers>;
  const plan = planFromAnswers(answers);
  const encoder = new TextEncoder();

  const userKey = await getUserKey().catch(() => "demo@lifeos.ai");
  const connection = await getNotionConnection(userKey).catch(() => null);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: GenStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* client disconnected */
        }
      };

      if (!connection) {
        await simulate(send, plan);
        send({
          index: genPhases.length, total: genPhases.length, progress: 1,
          state: "done", plan, mode: "simulated",
        });
        controller.close();
        return;
      }

      try {
        // Map the generator's own phase keys onto the UI's step list.
        const stepIndex: Record<string, number> = {
          verify: 0, databases: 1, relations: 2, dashboards: 3,
          templates: 4, automations: 5, seed: 8, assistant: 9, done: 10,
        };

        const manifest = await generateWorkspace({
          token: connection.token,
          rootPageId: connection.rootPageId,
          answers,
          onProgress: (e) => {
            const index = stepIndex[e.step] ?? 0;
            send({
              index,
              total: genPhases.length,
              label: genPhases[Math.min(index, genPhases.length - 1)]?.label,
              detail: e.label,
              progress: e.progress,
              state: "active",
              mode: "live",
            });
          },
        });

        send({
          index: genPhases.length, total: genPhases.length, progress: 1,
          state: "done", plan: manifest.databases.map((d) => d.key),
          mode: "live", workspaceUrl: manifest.databases[0]?.url,
        });
      } catch (err) {
        send({
          index: 0, total: genPhases.length, progress: 0, state: "error",
          detail: err instanceof Error ? err.message : "Generation failed.",
        });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Generation-Mode": connection ? "live" : "simulated",
    },
  });
}

async function simulate(send: (e: GenStreamEvent) => void, plan: string[]) {
  for (let i = 0; i < genPhases.length; i++) {
    const p = genPhases[i];
    send({
      index: i, total: genPhases.length, label: p.label, detail: p.detail(plan),
      progress: i / genPhases.length, state: "active", mode: "simulated",
    });
    await new Promise((r) => setTimeout(r, p.ms));
  }
}
