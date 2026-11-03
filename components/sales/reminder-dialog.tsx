"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { Modal } from "@/components/maps/modal";
import { useMessages } from "@/lib/i18n/client";
import { fill } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { mailtoOf, type PaymentReminder } from "@/lib/sales/reminder";
import { areaCls } from "./fields";

/** A payment reminder, written for the owner to send from their own mailbox — copied, or opened there. */
export function ReminderDialog({ open, onClose, number, reminder }: { open: boolean; onClose: () => void; number: string; reminder: PaymentReminder }) {
  const t = useMessages().sales;
  const r = t.reminder;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${r.subject} : ${reminder.subject}\n\n${reminder.body}`);
      setCopied(true);
      toast(r.copied);
    } catch {
      toast(t.errors.failed, "error");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={fill(r.title, { number })} closeLabel={t.close} wide>
      <div className="space-y-3 p-5">
        <p className={cn("text-[0.8125rem] font-medium", reminder.level === 2 ? "text-danger" : "text-warning")}>
          {reminder.level === 2 ? fill(r.level2, { days: reminder.daysLate }) : r.level1}
        </p>
        <label className="flex flex-col gap-1">
          <span className="text-[0.8125rem] text-muted-foreground">{r.subject}</span>
          <textarea readOnly rows={2} value={reminder.subject} className={cn(areaCls, "resize-none")} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[0.8125rem] text-muted-foreground">{r.body}</span>
          <textarea readOnly rows={14} value={reminder.body} className={cn(areaCls, "font-[inherit] leading-relaxed")} />
        </label>
        <p className="text-[0.75rem] leading-relaxed text-muted">{reminder.to ? r.note : r.noEmail}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={copy} className={buttonVariants({ variant: "secondary", size: "sm" })} data-autofocus>
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
            {r.copy}
          </button>
          {reminder.to && (
            <a href={mailtoOf(reminder)} className={buttonVariants({ size: "sm" })}>
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {r.open}
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
