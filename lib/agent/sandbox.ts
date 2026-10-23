import "server-only";
import { getQuickJS, shouldInterruptAfterDeadline } from "quickjs-emscripten";

/**
 * Exact calculation for the agent — the `compute` capability.
 *
 * The model writes a short JavaScript program; it runs in QuickJS compiled
 * to WebAssembly: its own heap, no network, no files, no clock beyond Date,
 * nothing of the server or of LifeOS. Bounded in time, memory and stack;
 * what it prints and its last value come back as text.
 */

export const SANDBOX_LIMITS = { timeoutMs: 5_000, memoryBytes: 64 * 1024 * 1024, stackBytes: 1024 * 1024, output: 8_000, code: 20_000 } as const;

export type SandboxResult = { ok: true; value: string; logs: string } | { ok: false; error: string; logs: string };

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n)}\n… (output cut at ${n} characters)`);

export async function runCode(code: string): Promise<SandboxResult> {
  if (typeof code !== "string" || !code.trim()) return { ok: false, error: "No code to run.", logs: "" };
  if (code.length > SANDBOX_LIMITS.code) return { ok: false, error: "The program is too long.", logs: "" };

  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(SANDBOX_LIMITS.memoryBytes);
  runtime.setMaxStackSize(SANDBOX_LIMITS.stackBytes);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + SANDBOX_LIMITS.timeoutMs));
  const vm = runtime.newContext();
  const logs: string[] = [];
  let size = 0;
  try {
    // console.log, the program's only way out: text, bounded.
    const consoleObj = vm.newObject();
    const log = vm.newFunction("log", (...args) => {
      const line = args.map((h) => {
        const v = vm.dump(h);
        return typeof v === "string" ? v : JSON.stringify(v);
      }).join(" ");
      if (size < SANDBOX_LIMITS.output) {
        logs.push(line);
        size += line.length + 1;
      }
    });
    vm.setProp(consoleObj, "log", log);
    vm.setProp(vm.global, "console", consoleObj);
    log.dispose();
    consoleObj.dispose();

    const result = vm.evalCode(code, "agent.js");
    if (result.error) {
      const err = vm.dump(result.error);
      result.error.dispose();
      const message = typeof err === "object" && err ? `${err.name ?? "Error"}: ${err.message ?? ""}` : String(err);
      return { ok: false, error: clip(message, 1_000), logs: clip(logs.join("\n"), SANDBOX_LIMITS.output) };
    }
    const value = vm.dump(result.value);
    result.value.dispose();
    const shown = value === undefined ? "undefined" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return { ok: true, value: clip(shown ?? "undefined", SANDBOX_LIMITS.output), logs: clip(logs.join("\n"), SANDBOX_LIMITS.output) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "The program failed.", logs: clip(logs.join("\n"), SANDBOX_LIMITS.output) };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
