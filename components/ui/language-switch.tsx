"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLocale } from "@/app/actions/locale";
import { useLocale } from "@/lib/i18n/client";
import { locales, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

export function LanguageSwitch() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();

  const pick = (l: Locale) => {
    if (l === locale || pending) return;
    start(async () => {
      await setLocale(l);
      router.refresh();
    });
  };

  return (
    <div className="flex items-center rounded-md border border-border bg-surface p-0.5 text-[0.7rem] font-medium">
      {locales.map((l) => (
        <button
          key={l}
          onClick={() => pick(l)}
          disabled={pending}
          aria-pressed={l === locale}
          // Small to the eye, but 32 px under a finger.
          className={cn(
            "relative rounded px-1.5 py-0.5 uppercase transition-colors [@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-x-0.5 [@media(pointer:coarse)]:before:-inset-y-1.5 [@media(pointer:coarse)]:before:content-['']",
            l === locale ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
