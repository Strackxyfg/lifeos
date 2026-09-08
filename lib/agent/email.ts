import "server-only";

/**
 * Outbound email for approved agent actions.
 *
 * Deliberately thin and deliberately honest: with no provider configured this
 * returns a failure that names what is missing, rather than reporting a
 * success for a message nobody received. The agent must never be able to say
 * "I emailed them" when it did not.
 */

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.AGENT_FROM_EMAIL);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}): Promise<SendResult> {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error:
        "No email provider is connected. Set RESEND_API_KEY and AGENT_FROM_EMAIL " +
        "(a verified sending domain) to let the agent send. Nothing was sent.",
    };
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(opts.to)) {
    return { ok: false, error: `"${opts.to}" is not a valid email address.` };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.AGENT_FROM_EMAIL,
        to: [opts.to],
        subject: opts.subject,
        text: opts.body,
        ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const payload = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      return { ok: false, error: `Provider refused the send (HTTP ${res.status}): ${payload.message ?? ""}`.trim() };
    }
    return { ok: true, id: payload.id ?? "sent" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed." };
  }
}
