import "server-only";
import { getAuthenticatedUserKey } from "@/lib/db/store";

/**
 * Gate for API routes, which the middleware matcher does not cover.
 *
 * Every AI route used to answer anyone: the assistant, the insights, the
 * capture classifier and workspace generation were all reachable without a
 * session. They leaked no personal data — signed-out requests fell back to the
 * demo workspace — but each was a free relay to the operator's model key. A
 * script calling them in a loop would exhaust the daily token budget and take
 * the AI down for every real user.
 *
 * Returns the caller's key, or a 401 response to return as-is.
 */
export async function requireUserKey(): Promise<{ userKey: string } | { response: Response }> {
  const userKey = await getAuthenticatedUserKey();
  if (userKey) return { userKey };
  return {
    response: new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  };
}
