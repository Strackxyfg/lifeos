"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { deleteMyData } from "@/app/actions/data";
import { buttonVariants } from "@/components/ui/button";
import { useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Two steps and a typed word. The button stays disabled until the word
 * matches, and the server checks it again — see `deleteMyData`.
 */
export function DeleteData() {
  const m = useMessages();
  const t = m.settings;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const matches = typed.trim().toUpperCase() === t.deleteWord;

  const confirm = async () => {
    if (!matches || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await deleteMyData(typed);
      if (res.ok) {
        // A clean slate: start again the way a new account does.
        router.push("/onboarding");
        return;
      }
      setError(res.code === "unauthorized" ? t.errors.unauthorized : t.deleteFailed);
    } catch {
      setError(t.deleteFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "border-danger/30 text-danger hover:bg-danger/10")}
      >
        {t.deleteCta}
      </button>
    );
  }

  return (
    <div className="w-full max-w-xs space-y-2">
      <label className="block">
        <span className="mb-1.5 block text-[0.75rem] text-muted-foreground">
          {fill(t.deleteConfirmLabel, { word: t.deleteWord })}
        </span>
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) void confirm();
            if (e.key === "Escape") setOpen(false);
          }}
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-lg border border-danger/30 bg-surface-2/40 px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-danger/40"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={confirm}
          disabled={!matches || pending}
          className={cn(
            buttonVariants({ size: "sm" }),
            "gap-1.5 bg-danger text-white hover:bg-danger/90 disabled:opacity-40"
          )}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          {pending ? t.deleting : t.deleteConfirm}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={pending}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t.cancel}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[0.75rem] leading-relaxed text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
