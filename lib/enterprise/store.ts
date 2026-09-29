import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { isSupabaseConfigured } from "@/lib/db/store";
import { localEnterpriseStore } from "./local";
import { supabaseEnterpriseStore } from "./supabase";
import type { EnterpriseStore } from "./types";

/** The active enterprise store: Supabase when configured, the local teams file otherwise. */
export function getEnterpriseStore(): EnterpriseStore {
  return isSupabaseConfigured() ? supabaseEnterpriseStore : localEnterpriseStore;
}

export const SCIM_TOKEN_PREFIX = "lifeos_scim_";
/** 256 bits, base64url: 43 characters after the prefix. */
export const SCIM_TOKEN_SHAPE = /^lifeos_scim_[A-Za-z0-9_-]{43}$/;

/** A new provisioning token. Shown once; only its hash is kept. */
export function newScimToken(): string {
  return SCIM_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A domain claim's token: 128 bits, hex (what 014's check expects). */
export function newDomainToken(): string {
  return randomBytes(16).toString("hex");
}
