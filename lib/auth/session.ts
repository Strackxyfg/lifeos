import { cookies } from "next/headers";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "./constants";

export interface Session {
  email: string;
}

/**
 * Demo session encoding. In production the session is Supabase's signed JWT in
 * an httpOnly cookie; here we base64 a small payload so the gate is real and
 * demonstrable without external services. Not a security boundary on its own.
 */
export function encodeSession(data: Session): string {
  return Buffer.from(JSON.stringify(data)).toString("base64");
}

export function decodeSession(raw: string): Session | null {
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString()) as Session;
  } catch {
    return null;
  }
}

/** Read the current session in a server component / action. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  return raw ? decodeSession(raw) : null;
}

/** Set the session cookie (call from a server action / route handler). */
export async function setSession(data: Session): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(data), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
