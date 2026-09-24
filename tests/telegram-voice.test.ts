import { describe, it, expect, vi, afterEach } from "vitest";
import { MAX_VOICE_SECONDS, VOICE_REPLIES, telegramVoiceDeps, voiceToText, type VoiceDeps } from "@/lib/agent/telegram-voice";
import { AIError } from "@/lib/ai/router";
import { MAX_AUDIO_BYTES } from "@/lib/ai/voice";

const voice = { file_id: "AwACAgQ", duration: 12, mime_type: "audio/ogg", file_size: 24_000 };

function deps(over: Partial<VoiceDeps> = {}): VoiceDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    available: () => true,
    allow: () => (calls.push("allow"), true),
    fileUrl: async (id) => (calls.push(`getFile ${id}`), "https://api.telegram.org/file/botX/voice/file_1.oga"),
    download: async () => (calls.push("download"), new Uint8Array([79, 103, 103, 83])),
    transcribe: async (file) => (calls.push(`transcribe ${file.name} ${file.type}`), "Rappelle-moi d'appeler Marc demain."),
    ...over,
  };
}

describe("a voice message to the bot", () => {
  it("becomes the text that was said, transcribed as Ogg", async () => {
    const d = deps();
    expect(await voiceToText(voice, d)).toEqual({ ok: true, text: "Rappelle-moi d'appeler Marc demain." });
    expect(d.calls).toEqual(["allow", "getFile AwACAgQ", "download", "transcribe voice.ogg audio/ogg"]);
  });

  it("refuses before downloading anything: too long, too large, unknown format, spent allowance", async () => {
    for (const [v, reason] of [
      [{ ...voice, duration: MAX_VOICE_SECONDS + 1 }, "too_long"],
      [{ ...voice, file_size: MAX_AUDIO_BYTES + 1 }, "too_large"],
      [{ ...voice, mime_type: "video/mp4" }, "unsupported"],
    ] as const) {
      const d = deps();
      expect(await voiceToText(v, d)).toEqual({ ok: false, reason });
      expect(d.calls).not.toContain("download");
    }
    const spent = deps({ allow: () => false });
    expect(await voiceToText(voice, spent)).toEqual({ ok: false, reason: "rate_limit" });
    expect(spent.calls).toEqual([]);
  });

  it("says so when transcription is not set up, or has nothing to say", async () => {
    expect(await voiceToText(voice, deps({ available: () => false }))).toEqual({ ok: false, reason: "unavailable" });
    expect(await voiceToText(voice, deps({ transcribe: async () => "   " }))).toEqual({ ok: false, reason: "empty" });
  });

  it("maps failures to answers, never throws", async () => {
    expect(await voiceToText(voice, deps({ fileUrl: async () => null }))).toEqual({ ok: false, reason: "failed" });
    expect(await voiceToText(voice, deps({ fileUrl: async () => Promise.reject(new Error("net")) }))).toEqual({ ok: false, reason: "failed" });
    expect(await voiceToText(voice, deps({ download: async () => null }))).toEqual({ ok: false, reason: "too_large" });
    expect(
      await voiceToText(voice, deps({ transcribe: async () => Promise.reject(new AIError("rate_limit", "resting")) }))
    ).toEqual({ ok: false, reason: "rate_limit" });
    expect(await voiceToText(voice, deps({ transcribe: async () => Promise.reject(new Error("boom")) }))).toEqual({ ok: false, reason: "failed" });
    for (const reason of ["unavailable", "too_long", "too_large", "unsupported", "rate_limit", "empty", "failed"] as const) {
      expect(VOICE_REPLIES[reason]).toMatch(/^🎤 /);
    }
  });
});

describe("downloading from Telegram", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** A response whose body arrives in chunks, with the size it claims. */
  function stream(chunks: number[], claimed?: number) {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const n of chunks) c.enqueue(new Uint8Array(n));
        c.close();
      },
    });
    return new Response(body, { headers: claimed === undefined ? {} : { "content-length": String(claimed) } });
  }

  it("stops a file that is larger than it said, as it arrives", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stream([600, 600, 600], 100)));
    expect(await telegramVoiceDeps("u@test.dev").download("https://x", 1_000)).toBeNull();
  });

  it("refuses a file that says it is too large without reading it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stream([10], 5_000)));
    expect(await telegramVoiceDeps("u@test.dev").download("https://x", 1_000)).toBeNull();
  });

  it("returns the bytes of a file within the limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => stream([300, 200])));
    expect((await telegramVoiceDeps("u@test.dev").download("https://x", 1_000))?.length).toBe(500);
  });
});
