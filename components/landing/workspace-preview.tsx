"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  LayoutDashboard, Boxes, Users, Wallet, Search, Plus,
  ArrowUpRight, ArrowDownRight, CircleDot, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

type TabId = "dashboard" | "projects" | "crm" | "finance";

const tabs: { id: TabId; label: string; icon: typeof Boxes }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: Boxes },
  { id: "crm", label: "CRM", icon: Users },
  { id: "finance", label: "Finance", icon: Wallet },
];

const statusStyles: Record<string, string> = {
  "In progress": "text-accent bg-accent/10",
  Planning: "text-warning bg-warning/10",
  Done: "text-success bg-success/10",
  Blocked: "text-danger bg-danger/10",
};

export function WorkspacePreview({ className }: { className?: string }) {
  const [tab, setTab] = useState<TabId>("dashboard");

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-surface shadow-lift",
        className
      )}
    >
      {/* Window chrome */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-4 py-3">
        <div className="flex gap-1.5">
          <span className="h-3 w-3 rounded-full bg-border-strong" />
          <span className="h-3 w-3 rounded-full bg-border-strong" />
          <span className="h-3 w-3 rounded-full bg-border-strong" />
        </div>
        <div className="mx-auto flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1 text-[0.6875rem] text-muted-foreground">
          <Search className="h-3 w-3" />
          notion.so / quinn-s-lifeos
        </div>
        <div className="flex items-center gap-1.5 text-[0.6875rem] text-accent">
          <Sparkles className="h-3 w-3" /> Live
        </div>
      </div>

      <div className="grid grid-cols-[168px_1fr] max-sm:grid-cols-1">
        {/* Sidebar */}
        <aside className="border-r border-border bg-surface-2/30 p-3 max-sm:hidden">
          <div className="mb-4 flex items-center gap-2 px-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-foreground text-[0.7rem] font-semibold text-background">
              Q
            </div>
            <span className="text-[0.8125rem] font-medium">Quinn's LifeOS</span>
          </div>
          <nav className="flex flex-col gap-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[0.8125rem] transition-colors",
                  tab === t.id
                    ? "bg-surface-2 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </nav>
          <div className="mt-4 border-t border-border pt-3">
            <p className="px-2 text-[0.6875rem] uppercase tracking-wider text-muted">
              Databases
            </p>
            {["Habits", "Journal", "Goals", "Reading"].map((d) => (
              <div key={d} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.8125rem] text-muted-foreground">
                <CircleDot className="h-3 w-3 opacity-50" /> {d}
              </div>
            ))}
          </div>
        </aside>

        {/* Main */}
        <div className="min-h-[340px] p-5">
          {/* Mobile tabs */}
          <div className="mb-4 flex gap-1.5 sm:hidden">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[0.75rem]",
                  tab === t.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease }}
            >
              {tab === "dashboard" && <DashboardView />}
              {tab === "projects" && <ProjectsView />}
              {tab === "crm" && <CrmView />}
              {tab === "finance" && <FinanceView />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ViewHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4 flex items-end justify-between">
      <div>
        <h3 className="text-[1.05rem] font-medium tracking-tight">{title}</h3>
        <p className="text-[0.75rem] text-muted-foreground">{sub}</p>
      </div>
      <button className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-[0.75rem] text-muted-foreground">
        <Plus className="h-3 w-3" /> New
      </button>
    </div>
  );
}

function DashboardView() {
  const kpis = [
    { label: "Active projects", value: "7", delta: "+2", up: true },
    { label: "This week's focus", value: "68%", delta: "+12%", up: true },
    { label: "Runway", value: "14 mo", delta: "-1", up: false },
  ];
  return (
    <div>
      <ViewHeader title="Good morning, Quinn" sub="Monday · 3 tasks due · 2 meetings" />
      <div className="grid grid-cols-3 gap-2.5 max-sm:grid-cols-1">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border border-border bg-surface-2/40 p-3">
            <p className="text-[0.7rem] text-muted-foreground">{k.label}</p>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-xl font-medium tracking-tight">{k.value}</span>
              <span className={cn("flex items-center text-[0.7rem]", k.up ? "text-success" : "text-warning")}>
                {k.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {k.delta}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border border-border bg-surface-2/40 p-3">
        <p className="mb-2 text-[0.7rem] uppercase tracking-wider text-muted">This week</p>
        {[
          { t: "Ship onboarding v2", p: 80 },
          { t: "Close Q3 finance review", p: 45 },
          { t: "Draft investor update", p: 20 },
        ].map((r) => (
          <div key={r.t} className="mb-2 last:mb-0">
            <div className="mb-1 flex justify-between text-[0.75rem]">
              <span>{r.t}</span>
              <span className="text-muted-foreground">{r.p}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-background">
              <div className="h-full rounded-full bg-accent" style={{ width: `${r.p}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProjectsView() {
  const rows = [
    { name: "Onboarding v2", status: "In progress", owner: "Quinn", due: "Jul 28" },
    { name: "Pricing experiment", status: "Planning", owner: "Maya", due: "Aug 04" },
    { name: "Notion API hardening", status: "In progress", owner: "Dan", due: "Jul 31" },
    { name: "Investor deck", status: "Blocked", owner: "Quinn", due: "Jul 26" },
    { name: "Launch page", status: "Done", owner: "Priya", due: "Jul 20" },
  ];
  return (
    <div>
      <ViewHeader title="Projects" sub="5 of 7 shown · grouped by status" />
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="grid grid-cols-[1fr_88px_72px_64px] gap-2 border-b border-border bg-surface-2/40 px-3 py-2 text-[0.68rem] uppercase tracking-wider text-muted">
          <span>Name</span><span>Status</span><span>Owner</span><span>Due</span>
        </div>
        {rows.map((r) => (
          <div key={r.name} className="grid grid-cols-[1fr_88px_72px_64px] items-center gap-2 border-b border-border px-3 py-2.5 text-[0.8rem] last:border-0">
            <span className="truncate">{r.name}</span>
            <span className={cn("w-fit rounded-full px-2 py-0.5 text-[0.68rem]", statusStyles[r.status])}>{r.status}</span>
            <span className="text-muted-foreground">{r.owner}</span>
            <span className="text-muted-foreground">{r.due}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CrmView() {
  const cols = [
    { stage: "Lead", deals: ["Northwind", "Acme Co"] },
    { stage: "Qualified", deals: ["Globex"] },
    { stage: "Won", deals: ["Initech", "Umbrella"] },
  ];
  return (
    <div>
      <ViewHeader title="Pipeline" sub="$142k open · 5 deals" />
      <div className="grid grid-cols-3 gap-2.5">
        {cols.map((c) => (
          <div key={c.stage} className="rounded-lg border border-border bg-surface-2/30 p-2.5">
            <p className="mb-2 text-[0.7rem] font-medium text-muted-foreground">{c.stage}</p>
            <div className="flex flex-col gap-2">
              {c.deals.map((d) => (
                <div key={d} className="rounded-md border border-border bg-surface p-2 text-[0.78rem]">
                  <p className="font-medium">{d}</p>
                  <p className="text-[0.68rem] text-muted-foreground">${(Math.random() * 40 + 10).toFixed(0)}k · Q3</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FinanceView() {
  const bars = [42, 55, 38, 68, 71, 60, 82];
  return (
    <div>
      <ViewHeader title="Finance" sub="July · net +$8,240" />
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-[0.7rem] text-muted-foreground">Income</p>
          <p className="text-xl font-medium tracking-tight">$24,180</p>
          <span className="text-[0.7rem] text-success">+18% vs. June</span>
        </div>
        <div className="rounded-lg border border-border bg-surface-2/40 p-3">
          <p className="text-[0.7rem] text-muted-foreground">Expenses</p>
          <p className="text-xl font-medium tracking-tight">$15,940</p>
          <span className="text-[0.7rem] text-warning">+4% vs. June</span>
        </div>
      </div>
      <div className="mt-3 flex h-24 items-end gap-1.5 rounded-lg border border-border bg-surface-2/40 p-3">
        {bars.map((b, i) => (
          <div key={i} className="flex-1 rounded-t-sm bg-accent/70" style={{ height: `${b}%` }} />
        ))}
      </div>
    </div>
  );
}
