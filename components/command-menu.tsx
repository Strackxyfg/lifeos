"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Search, Sparkles, LayoutDashboard, Boxes, Users, Wallet,
  Settings, CreditCard, ArrowRight, CornerDownLeft, BarChart3, UsersRound, Brain,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Kbd } from "@/components/ui/kbd";

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: typeof Boxes;
  group: string;
  href?: string;
  action?: () => void;
};

/** Fire this anywhere to open the palette: window.dispatchEvent(new Event("lifeos:command")) */
export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(
    () => [
      { id: "gen", label: "Generate a new workspace", hint: "60s", icon: Sparkles, group: "Actions", href: "/onboarding" },
      { id: "assistant", label: "Ask your assistant", hint: "G A", icon: Sparkles, group: "Actions", href: "/assistant" },
      { id: "brain", label: "Open Second Brain", hint: "G R", icon: Brain, group: "Navigate", href: "/brain" },
      { id: "dash", label: "Go to Dashboard", hint: "G D", icon: LayoutDashboard, group: "Navigate", href: "/dashboard" },
      { id: "proj", label: "Open Projects", hint: "G P", icon: Boxes, group: "Navigate", href: "/projects" },
      { id: "crm", label: "Open CRM", hint: "G C", icon: Users, group: "Navigate", href: "/crm" },
      { id: "fin", label: "Open Finance", hint: "G F", icon: Wallet, group: "Navigate", href: "/finance" },
      { id: "analytics", label: "Open Analytics", icon: BarChart3, group: "Navigate", href: "/analytics" },
      { id: "team", label: "Manage Team", icon: UsersRound, group: "Account", href: "/team" },
      { id: "billing", label: "Billing & plan", icon: CreditCard, group: "Account", href: "/billing" },
      { id: "settings", label: "Settings", hint: "⌘,", icon: Settings, group: "Account", href: "/settings" },
    ],
    []
  );

  const run = (c?: Command) => {
    if (!c) return;
    setOpen(false);
    if (c.href) router.push(c.href);
    else c.action?.();
  };

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q));
  }, [commands, query]);

  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("lifeos:command", toggle);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lifeos:command", toggle);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); run(results[active]); }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[18vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog"
            aria-label="Command menu"
            className="glass relative w-full max-w-xl overflow-hidden rounded-xl border border-border-strong shadow-lift"
            initial={{ opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            onKeyDown={onListKey}
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search commands…"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted"
              />
              <Kbd>ESC</Kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 && (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">No results</li>
              )}
              {results.map((c, i) => (
                <li key={c.id}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => run(c)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                      i === active ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <c.icon className={cn("h-4 w-4", c.group === "Actions" && "text-accent")} />
                    <span className="flex-1">{c.label}</span>
                    {c.hint && <span className="text-[0.7rem] text-muted">{c.hint}</span>}
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-muted" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[0.7rem] text-muted">
              <span className="flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-accent" /> LifeOS</span>
              <span className="flex items-center gap-2">
                <Kbd>↑</Kbd><Kbd>↓</Kbd> to navigate · <Kbd><ArrowRight className="h-2.5 w-2.5" /></Kbd> select
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
