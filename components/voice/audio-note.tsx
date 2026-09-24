"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { toAudioWords, wordsIn, type AudioWord } from "@/lib/voice/align";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const RATES = [1, 1.25, 1.5, 2] as const;

/**
 * Recordings held in memory for the page, one download each, shared by every
 * note of the same memo. A recording made by MediaRecorder has no seek index
 * (Cues): played from the server, each seek became a series of range
 * requests and the passage started ~2 s late. From memory it starts at once.
 * Nothing goes to the disk cache — the server says no-store, and this lives
 * only as long as the page.
 */
const loaded = new Map<string, Promise<string>>();
function recordingUrl(id: string): Promise<string> {
  let url = loaded.get(id);
  if (!url) {
    url = fetch(`/api/brain/audio/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => URL.createObjectURL(blob));
    // A failed download may be retried on the next attempt.
    url.catch(() => loaded.delete(id));
    loaded.set(id, url);
  }
  return url;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The word being said at `ms`: the last one started, if it has not ended long ago. */
function wordAt(words: AudioWord[], ms: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].s <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && ms <= words[found].e + 400 ? found : -1;
}

/**
 * A note's recording. A whole voice note plays all of it with its transcript
 * lit word by word — click a word to go there. A note split out of a memo
 * plays its own passage, with the whole memo one click away.
 *
 * The duration comes from the transcript, not the file: a recording made by
 * MediaRecorder carries no duration, and the browser reports "Infinity".
 */
export function AudioNote({
  audio,
  onTranscript,
}: {
  audio: { id: string; start: number | null; end: number | null };
  /** The transcript's text once loaded — the note shows it instead of an editor while it is unedited. */
  onTranscript?: (text: string) => void;
}) {
  const m = useMessages();
  const t = m.voiceNote;
  const el = useRef<HTMLAudioElement>(null);
  const [meta, setMeta] = useState<{ durationMs: number; words: AudioWord[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [pos, setPos] = useState(audio.start ?? 0);
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const passage = audio.start !== null;
  const [whole, setWhole] = useState(!passage);
  const said = useRef(onTranscript);
  said.current = onTranscript;
  const [ready, setReady] = useState(false);

  // The recording, loaded ahead of the first click: a play started inside the
  // click is what iOS allows, and it can only start at once if it is here.
  useEffect(() => {
    let live = true;
    setReady(false);
    recordingUrl(audio.id)
      .then((url) => {
        const a = el.current;
        if (!live || !a) return;
        a.src = url;
        a.load();
        setReady(true);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [audio.id]);

  useEffect(() => {
    let live = true;
    setMeta(null);
    setFailed(false);
    fetch(`/api/brain/audio/${encodeURIComponent(audio.id)}?meta=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { durationMs?: number; words?: unknown }) => {
        if (!live) return;
        const words = toAudioWords(j.words);
        setMeta({ durationMs: typeof j.durationMs === "number" ? j.durationMs : words.at(-1)?.e ?? 0, words });
        said.current?.(words.map((w) => w.w).join(" "));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [audio.id]);

  const duration = meta?.durationMs ?? 0;
  const range = useMemo(
    () => (whole || !passage ? { start: 0, end: duration } : { start: audio.start ?? 0, end: audio.end ?? duration }),
    [whole, passage, audio.start, audio.end, duration]
  );
  // Each word with its index, computed once: looking it up per word per frame would be quadratic.
  const shown = useMemo(() => {
    if (!meta) return [];
    const all = meta.words.map((w, i) => ({ w, i }));
    if (whole) return all;
    const inRange = new Set(wordsIn(meta.words, range.start, range.end));
    return all.filter((x) => inRange.has(x.w));
  }, [meta, whole, range]);
  const current = useMemo(() => (meta ? wordAt(meta.words, pos) : -1), [meta, pos]);

  // While playing: follow the time, and stop at the end of a passage. The
  // position reaches React only when the word changes or every tenth of a
  // second — not sixty times a second through a long transcript.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = 0;
    let lastWord = -2;
    const tick = (now: number) => {
      const a = el.current;
      if (a) {
        const ms = a.currentTime * 1000;
        if (!whole && passage && ms >= range.end) {
          a.pause();
          a.currentTime = range.start / 1000;
          setPos(range.start);
          return;
        }
        const w = meta ? wordAt(meta.words, ms) : -1;
        if (w !== lastWord || now - last > 100) {
          lastWord = w;
          last = now;
          setPos(ms);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, whole, passage, range, meta]);

  const seek = (ms: number, play = false) => {
    const a = el.current;
    if (!a) return;
    a.currentTime = Math.max(0, ms) / 1000;
    setPos(ms);
    if (play && a.paused) void start();
  };

  async function start() {
    const a = el.current;
    if (!a || !ready) return;
    const ms = a.currentTime * 1000;
    if (ms < range.start || ms >= range.end - 60) a.currentTime = range.start / 1000;
    a.playbackRate = rate;
    try {
      await a.play();
    } catch {
      setFailed(true);
    }
  }

  const toggle = () => (playing ? el.current?.pause() : void start());
  const nextRate = () => {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(r);
    if (el.current) el.current.playbackRate = r;
  };

  if (failed) return <p className="mt-3 text-[0.72rem] text-muted">{t.unavailable}</p>;

  const span = Math.max(1, range.end - range.start);
  const progress = Math.min(1, Math.max(0, (pos - range.start) / span));

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/30 p-2.5">
      <audio
        ref={el}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onError={() => setFailed(true)}
      />
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          disabled={!meta || !ready}
          aria-label={playing ? t.pause : t.play}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background disabled:opacity-40"
        >
          {waiting && playing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
        </button>
        <div
          role="slider"
          tabIndex={0}
          aria-label={t.position}
          aria-valuemin={0}
          aria-valuemax={Math.round(span / 1000)}
          aria-valuenow={Math.round((pos - range.start) / 1000)}
          aria-valuetext={`${clock(pos - range.start)} / ${clock(span)}`}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            seek(range.start + ((e.clientX - box.left) / box.width) * span);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") seek(Math.min(range.end, pos + 5_000));
            if (e.key === "ArrowLeft") seek(Math.max(range.start, pos - 5_000));
            if (e.key === " ") {
              e.preventDefault();
              toggle();
            }
          }}
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-border outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <span className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="w-[4.5rem] shrink-0 text-right font-mono text-[0.68rem] tabular-nums text-muted-foreground">
          {meta ? `${clock(pos - range.start)} / ${clock(span)}` : "…"}
        </span>
        <button
          type="button"
          onClick={nextRate}
          aria-label={t.speed}
          title={t.speed}
          className="w-9 shrink-0 rounded border border-border px-1 py-px font-mono text-[0.64rem] text-muted-foreground hover:text-foreground"
        >
          {rate}×
        </button>
      </div>

      {passage && (
        <div className="mt-1.5 flex items-center justify-between text-[0.66rem] text-muted">
          <span>{whole ? t.whole : `${t.passage} · ${clock(audio.start ?? 0)}–${clock(audio.end ?? duration)}`}</span>
          <button type="button" onClick={() => setWhole((w) => !w)} className="underline-offset-2 hover:text-foreground hover:underline">
            {whole ? t.passageOnly : t.wholeMemo}
          </button>
        </div>
      )}

      {shown.length > 0 && (whole || passage) && (
        <p className={cn("mt-2 text-[0.8rem] leading-relaxed", passage && !whole && "text-muted-foreground")} aria-label={t.transcript}>
          {shown.map(({ w, i }) => {
            const inPassage = passage && whole && w.e > (audio.start ?? 0) && w.s < (audio.end ?? duration);
            return (
              <span key={`${w.s}-${i}`}>
                <button
                  type="button"
                  onClick={() => seek(w.s, true)}
                  className={cn(
                    "rounded-sm transition-colors hover:bg-accent/15",
                    i === current && playing && "bg-accent/25 text-foreground",
                    inPassage && "text-accent"
                  )}
                >
                  {w.w}
                </button>{" "}
              </span>
            );
          })}
        </p>
      )}
    </div>
  );
}
