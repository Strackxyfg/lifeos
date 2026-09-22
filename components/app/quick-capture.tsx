"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, Plus } from "lucide-react";
import { createNote } from "@/app/actions/brain";
import { announceCaptured, classifyThought, OPEN_CAPTURE_EVENT } from "@/components/brain/classify-client";
import { toast } from "@/components/ui/toaster";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

/**
 * Capture a thought from any page. It used to be a "New workspace" button
 * that restarted onboarding; capturing is what a second brain is for, and it
 * should never be more than one click away.
 */
export function QuickCapture() {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  // Synchronous guard: Enter pressed twice fires before any state update lands.
  const busy = useRef(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_CAPTURE_EVENT, show);
    return () => window.removeEventListener(OPEN_CAPTURE_EVENT, show);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const save = useCallback(async () => {
    const title = text.trim();
    if (!title || busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const category = await classifyThought(title, locale);
      const res = await createNote({ title, category });
      if (res.ok) {
        announceCaptured({
          id: res.data.id,
          category,
          kind: res.data.kind,
          title,
          detail: res.data.detail,
          done: res.data.done,
          ai: res.data.ai,
          createdAt: res.data.createdAt,
        });
        toast(`${m.brain.captured} · ${m.brain.cat[category].label}`);
        setText("");
        setOpen(false);
        router.refresh(); // counts on the dashboard and elsewhere follow
      } else {
        toast(m.brain.errors[res.code], "error"); // the words stay in the field
      }
    } catch {
      toast(m.brain.errors.failed, "error");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [text, locale, m, router]);

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(buttonVariants({ size: "sm" }))}
      >
        <Plus className="h-4 w-4" /> {m.common.capture}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease }}
            className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface p-3 shadow-lift"
          >
            <textarea
              // On mount, not in an animation frame: frames are paused in a
              // background tab, and the field has to be ready as it opens.
              autoFocus
              rows={3}
              value={text}
              maxLength={500}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
              placeholder={m.brain.capturePlaceholder}
              aria-label={m.common.capture}
              className="w-full resize-none rounded-lg border border-border bg-surface-2/40 p-2.5 text-sm leading-relaxed outline-none placeholder:text-muted focus:border-border-strong"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[0.68rem] text-muted-foreground">{m.common.captureHint}</p>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!text.trim() || saving}
                className={cn(buttonVariants({ size: "sm" }), "gap-1.5 disabled:opacity-40")}
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {m.brain.capture}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
