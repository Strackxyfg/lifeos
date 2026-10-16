"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { EMOJI_GROUPS, findEmoji } from "@/lib/maps/emoji";
import { cleanEmoji } from "@/lib/maps/model";
import { cn } from "@/lib/utils";
import { EMOJI_FONT } from "@/lib/maps/draw";

/** The emojis mind maps use, by group and by word — and any other one, typed or pasted. */
export function EmojiPicker({ value, onPick, autoFocus }: { value?: string; onPick: (emoji: string | undefined) => void; autoFocus?: boolean }) {
  const t = useMessages().maps.inspector;
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const found = useMemo(() => {
    if (!query.trim()) return null;
    const typed = cleanEmoji(query.trim());
    const words = findEmoji(query);
    return typed && !words.includes(typed) ? [typed, ...words] : words;
  }, [query]);

  const cell = (e: string) => (
    <button
      key={e}
      type="button"
      onClick={() => onPick(e === value ? undefined : e)}
      aria-pressed={e === value}
      aria-label={e}
      className={cn(
        "grid aspect-square place-items-center rounded-lg text-[1.25rem] leading-none transition-[background,transform] hover:scale-110 hover:bg-surface-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/80",
        e === value && "bg-accent/15 ring-1 ring-accent/50"
      )}
      style={{ fontFamily: EMOJI_FONT }}
    >
      {e}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-background/60 px-2.5 focus-within:border-border-strong">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.emojiSearch}
            aria-label={t.emojiSearch}
            autoFocus={autoFocus}
            className="min-w-0 flex-1 bg-transparent py-2 text-[0.8125rem] outline-none placeholder:text-muted-foreground [@media(pointer:coarse)]:text-base"
          />
        </label>
        {value && (
          <button
            type="button"
            onClick={() => onPick(undefined)}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            {t.emojiNone}
          </button>
        )}
      </div>
      {found ? (
        found.length ? (
          <div className="grid grid-cols-8 gap-0.5">{found.map(cell)}</div>
        ) : (
          <p className="text-[0.75rem] text-muted-foreground">{t.emojiPaste}</p>
        )
      ) : (
        <div className="max-h-[15.5rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
          {EMOJI_GROUPS.map((g) => (
            <div key={g.id}>
              <p className="mb-1 text-[0.6875rem] text-muted-foreground">{g.name[locale]}</p>
              <div className="grid grid-cols-8 gap-0.5">{g.items.map(([e]) => cell(e))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
