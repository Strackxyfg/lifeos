/**
 * The JSON inside a model's answer, or null.
 *
 * Asking for JSON does not guarantee getting only JSON. Models wrap it in code
 * fences, prefix it with a sentence, or — reasoning models — think aloud in a
 * <think> block first, which may itself contain braces. This strips the
 * thinking, then takes the first balanced object or array that parses.
 * Never throws: a malformed answer is the caller's "no result", not a crash.
 */
export function extractJson(raw: string | null | undefined): unknown {
  if (!raw) return null;
  const text = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "") // an unterminated think block: nothing after it is an answer
    .replace(/```(?:json)?/gi, "")
    .trim();

  try {
    return JSON.parse(text);
  } catch {
    /* fall through to scanning */
  }

  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          break; // balanced but invalid: try the next opening brace
        }
      }
    }
  }
  return null;
}
