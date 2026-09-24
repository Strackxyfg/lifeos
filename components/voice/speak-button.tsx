"use client";

import { useId } from "react";
import { Square, Volume2 } from "lucide-react";
import { speakText, stopSpeaking } from "@/lib/voice/speaker";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useSpeech } from "./use-speech";

/** Reads a text aloud with the device's voice; pressed again, stops. Hidden where the browser cannot speak. */
export function SpeakButton({ text, compact = false, className }: { text: string; compact?: boolean; className?: string }) {
  const id = useId();
  const m = useMessages();
  const locale = useLocale();
  const s = useSpeech();
  if (!s.supported || !text.trim()) return null;
  const mine = s.speaking && s.owner === id;
  const label = mine ? m.voice.stop : m.voice.listen;
  return (
    <button
      type="button"
      onClick={() => (mine ? stopSpeaking() : speakText(id, text, locale))}
      aria-pressed={mine}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-[0.74rem] transition-colors",
        mine ? "text-accent" : "text-muted-foreground hover:text-foreground",
        className
      )}
    >
      {mine ? <Square className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
      {!compact && label}
    </button>
  );
}
