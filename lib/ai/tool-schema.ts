import type { ToolSchema } from "./types";

/**
 * A tool's arguments schema as a provider is sent it.
 *
 * Some providers validate the arguments a model writes against the schema on
 * their own side and refuse the whole answer when a text runs past its
 * `maxLength` (Groq does). For a text LifeOS would rather tighten than refuse
 * — marked `clip: true` — the length is checked by LifeOS (`checkArgs`, which
 * cuts it at a word), so it is left out here, with the `clip` mark, which is
 * LifeOS's own and no provider's.
 */
export function forProvider(schema: ToolSchema): ToolSchema {
  return strip(schema) as ToolSchema;
}

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "clip") continue;
    if (k === "maxLength" && src.clip === true) continue;
    out[k] = strip(v);
  }
  return out;
}
