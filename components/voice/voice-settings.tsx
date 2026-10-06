"use client";

import { useMemo } from "react";
import { Volume2 } from "lucide-react";
import { chooseVoice, setVoicePrefs, speakText } from "@/lib/voice/speaker";
import { rankVoices, type VoiceLike } from "@/lib/voice/speech";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { SwitchTrack } from "@/components/ui/switch";
import { useDeviceVoices, useSpeech, useVoicePrefs } from "./use-speech";

/**
 * How LifeOS speaks, on this device. Online voices are off until chosen, and
 * the choice says what it costs: the text read aloud leaves the device.
 */
export function VoiceSettings() {
  const m = useMessages();
  const locale = useLocale();
  const t = m.voice;
  const s = useSpeech();
  const prefs = useVoicePrefs();
  const voices = useDeviceVoices();

  const ranked = useMemo(() => rankVoices(voices as unknown as VoiceLike[], locale, true), [voices, locale]);
  const local = ranked.filter((v) => v.localService);
  const online = ranked.filter((v) => !v.localService);
  // The voice actually used, which may differ from the stored choice (online voice now disallowed…).
  const current = useMemo(() => (voices.length ? chooseVoice(locale, prefs) : null), [voices, locale, prefs]);

  if (!s.supported) return <p className="p-5 text-sm text-muted-foreground">{t.unsupported}</p>;

  return (
    <div className="divide-y divide-border">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <label htmlFor="voice-pick" className="text-sm font-medium">{t.voice}</label>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{t.settingsHint}</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <select
            id="voice-pick"
            value={current?.voiceURI ?? ""}
            onChange={(e) => {
              const v = ranked.find((x) => x.voiceURI === e.target.value);
              setVoicePrefs({ voiceURI: e.target.value || null, ...(v && !v.localService ? { allowOnline: true } : {}) });
            }}
            className="h-9 min-w-0 flex-1 rounded-md border border-border bg-surface-2/40 px-2 text-[0.8rem] outline-none focus:border-border-strong sm:max-w-[260px] sm:flex-none"
          >
            {ranked.length === 0 && <option value="">{t.none}</option>}
            {local.length > 0 && (
              <optgroup label={t.onDevice}>
                {local.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                ))}
              </optgroup>
            )}
            {online.length > 0 && (
              <optgroup label={t.online}>
                {online.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            onClick={() => speakText("voice-settings", t.sample, locale)}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[0.78rem] hover:border-border-strong"
          >
            <Volume2 className="h-3.5 w-3.5" /> {t.test}
          </button>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-4 p-5">
        <div className="flex-1">
          <p className="text-sm font-medium">{t.allowOnline}</p>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{t.allowOnlineHint}</p>
        </div>
        <input
          type="checkbox"
          className="peer sr-only"
          checked={prefs.allowOnline}
          onChange={(e) => setVoicePrefs({ allowOnline: e.target.checked })}
        />
        <SwitchTrack on={prefs.allowOnline} />
      </label>

      <label className="flex cursor-pointer items-start gap-4 p-5">
        <div className="flex-1">
          <p className="text-sm font-medium">{t.autoRead}</p>
          <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{t.autoReadHint}</p>
        </div>
        <input
          type="checkbox"
          className="peer sr-only"
          checked={prefs.autoRead}
          onChange={(e) => setVoicePrefs({ autoRead: e.target.checked })}
        />
        <SwitchTrack on={prefs.autoRead} />
      </label>

      <div className="flex items-center gap-4 p-5">
        <label htmlFor="voice-rate" className="flex-1 text-sm font-medium">{t.rate}</label>
        <input
          id="voice-rate"
          type="range"
          min={0.7}
          max={1.5}
          step={0.05}
          value={prefs.rate}
          onChange={(e) => setVoicePrefs({ rate: Number(e.target.value) })}
          className="h-8 w-40 accent-[#22d3ee]"
        />
        <span className="w-10 text-right font-mono text-[0.75rem] text-muted-foreground">{prefs.rate.toFixed(2)}×</span>
      </div>
    </div>
  );
}
