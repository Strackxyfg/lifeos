"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { setTaskDone } from "@/app/actions/workspace";
import { cn } from "@/lib/utils";
import { useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";

type Task = { id: string; t: string; done: boolean };

/** Today's list — toggling persists to the database (optimistic, reverts on failure). */
export function TodayTasks({ initial }: { initial: Task[] }) {
  const m = useMessages();
  const [tasks, setTasks] = useState<Task[]>(initial);
  const [, start] = useTransition();
  const done = tasks.filter((t) => t.done).length;

  const toggle = (id: string) => {
    const target = tasks.find((t) => t.id === id);
    if (!target) return;
    const next = !target.done;

    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: next } : t)));
    start(async () => {
      const res = await setTaskDone(id, next);
      if (!res.ok) {
        setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !next } : t)));
      }
    });
  };

  return (
    <Card>
      <CardHeader
        title={
          <span>
            {m.dashboard.today}{" "}
            <span className="font-normal text-muted-foreground">
              · {fill(m.dashboard.doneCount, { done, total: tasks.length })}
            </span>
          </span>
        }
      />
      <ul className="divide-y divide-border">
        {tasks.map((task) => (
          <li key={task.id}>
            <button
              onClick={() => toggle(task.id)}
              className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2/40"
            >
              {task.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-border-strong" />
              )}
              <span className={cn("text-sm transition-colors", task.done && "text-muted-foreground line-through")}>
                {task.t}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
