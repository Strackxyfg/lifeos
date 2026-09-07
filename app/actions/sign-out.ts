"use server";

import { redirect } from "next/navigation";
import { clearSession } from "@/lib/auth/session";
import { createRlsClient } from "@/lib/supabase/rls";
import { isSupabaseConfigured } from "@/lib/db/store";

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createRlsClient();
    await supabase.auth.signOut();
  }
  // Always clear the demo cookie too, so switching backends can't strand a session.
  await clearSession();
  redirect("/");
}
