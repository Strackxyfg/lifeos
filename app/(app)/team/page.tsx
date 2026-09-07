import type { Metadata } from "next";
import { Plus, Mail } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getMessages } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Team" };

const members = [
  { name: "Quinn Sky", email: "quincy.skyll@gmail.com", role: "Owner" },
  { name: "Maya Chen", email: "maya@team.co", role: "Admin" },
  { name: "Dan Okafor", email: "dan@team.co", role: "Member" },
];

const invites = [{ email: "priya@team.co", role: "Member" }];

export default async function TeamPage() {
  const m = await getMessages();
  return (
    <>
      <PageHeader
        title={m.pages.team.title}
        description={m.pages.team.desc}
        action={
          <button className={buttonVariants({ size: "sm" })}>
            <Plus className="h-4 w-4" /> {m.common.inviteMember}
          </button>
        }
      />

      <Card>
        <CardHeader title={`Members · ${members.length}`} />
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.email} className="flex items-center gap-3 px-5 py-3.5">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-sm font-medium">
                {m.name.split(" ").map((n) => n[0]).join("")}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-[0.75rem] text-muted-foreground">{m.email}</p>
              </div>
              <span className="rounded-full border border-border bg-surface-2/50 px-2.5 py-0.5 text-[0.72rem] text-muted-foreground">
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Pending invites" />
        {invites.length ? (
          <ul className="divide-y divide-border">
            {invites.map((i) => (
              <li key={i.email} className="flex items-center gap-3 px-5 py-3.5">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="flex-1">
                  <p className="text-sm">{i.email}</p>
                  <p className="text-[0.72rem] text-muted-foreground">Invited · {i.role}</p>
                </div>
                <button className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Revoke</button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No pending invites.</p>
          </div>
        )}
      </Card>
    </>
  );
}
