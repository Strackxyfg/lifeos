"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutGrid, Rows3 } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Table, Thead, Th, Tr, Td } from "@/components/ui/table";
import { projectStatuses, statusColor, priorityColor } from "@/lib/data/workspace";
import type { DbProject } from "@/lib/db/types";
import { useMessages } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { ease } from "@/lib/motion";

type ViewMode = "board" | "table";

export function ProjectsView({ projects }: { projects: DbProject[] }) {
  const m = useMessages();
  const [view, setView] = useState<ViewMode>("board");

  return (
    <div>
      <div className="mb-5 flex items-center">
        <Segmented<ViewMode>
          value={view}
          onChange={setView}
          layoutId="projects-view"
          options={[
            { value: "board", label: m.common.board, icon: <LayoutGrid className="h-3.5 w-3.5" /> },
            { value: "table", label: m.common.table, icon: <Rows3 className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.24, ease }}
        >
          {view === "board" ? <Board projects={projects} /> : <TableView projects={projects} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function Board({ projects }: { projects: DbProject[] }) {
  const m = useMessages();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {projectStatuses.map((status) => {
        const items = projects.filter((p) => p.status === status);
        return (
          <div key={status} className="rounded-xl border border-border bg-surface/50 p-2.5">
            <div className="mb-2.5 flex items-center justify-between px-1.5">
              <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem]", statusColor[status])}>{m.labels[status]}</span>
              <span className="text-[0.72rem] text-muted">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {items.map((p) => (
                <div
                  key={p.id}
                  className="group cursor-default rounded-lg border border-border bg-surface p-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-card"
                >
                  <p className="text-[0.875rem] font-medium">{p.name}</p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${p.progress}%` }} />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-[0.72rem] text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <span className="grid h-4 w-4 place-items-center rounded-full bg-surface-2 text-[0.6rem]">
                        {p.owner[0]}
                      </span>
                      {p.owner}
                    </span>
                    <span className={priorityColor[p.priority]}>{p.due}</span>
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <p className="px-1.5 py-4 text-center text-[0.75rem] text-muted">{m.common.nothingHere}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ projects }: { projects: DbProject[] }) {
  const m = useMessages();
  return (
    <Table>
      <Thead>
        <tr>
          <Th className="w-2/5">Project</Th>
          <Th>Status</Th>
          <Th>Owner</Th>
          <Th>Priority</Th>
          <Th className="text-right">Due</Th>
        </tr>
      </Thead>
      <tbody>
        {projects.map((p) => (
          <Tr key={p.id}>
            <Td>
              <div className="flex items-center gap-3">
                <span className="font-medium">{p.name}</span>
                <span className="text-[0.72rem] text-muted">{p.progress}%</span>
              </div>
            </Td>
            <Td>
              <span className={cn("rounded-full px-2 py-0.5 text-[0.7rem]", statusColor[p.status])}>{m.labels[p.status]}</span>
            </Td>
            <Td className="text-muted-foreground">{p.owner}</Td>
            <Td className={priorityColor[p.priority]}>{m.labels[p.priority]}</Td>
            <Td className="text-right text-muted-foreground">{p.due}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
