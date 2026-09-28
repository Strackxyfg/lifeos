"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/toaster";
import { useMessages } from "@/lib/i18n/client";
import type { TeamResult } from "@/app/actions/team";

/**
 * Runs a team action: a toast in the person's language when it is refused,
 * then the page re-read from the server — the team's state is the server's,
 * never an optimistic guess about what another member did.
 */
export function useTeamAction() {
  const m = useMessages();
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = useCallback(
    async <T,>(action: () => Promise<TeamResult<T>>, success?: string): Promise<T | null> => {
      const res = await action();
      if (!res.ok) {
        toast(m.team.errors[res.code], "error");
        return null;
      }
      if (success) toast(success);
      start(() => router.refresh());
      return res.data;
    },
    [m, router]
  );

  return { run, pending };
}
