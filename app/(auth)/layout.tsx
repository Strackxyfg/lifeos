import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getLocale, getMessages } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/ui/language-switch";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);

  return (
    <LocaleProvider locale={locale} messages={messages}>
      <div className="grid min-h-dvh lg:grid-cols-2">
        {/* Brand panel */}
        <div className="relative hidden overflow-hidden border-r border-border bg-surface/40 lg:block">
          <div className="pointer-events-none absolute inset-0">
            <div className="bg-grid absolute inset-0 opacity-[0.35]" />
            <div className="bg-aurora absolute inset-0" />
          </div>
          <div className="relative flex h-full flex-col justify-between p-12">
            <Link href="/" className="flex items-center gap-2 font-medium tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
                <Sparkles className="h-4 w-4" />
              </span>
              LifeOS
            </Link>
            {/* A statement of what the product is — not a quote. This spot used
                to hold an invented testimonial attributed to a "Maya Chen". */}
            <p className="max-w-md text-balance text-xl font-medium leading-snug tracking-tight text-foreground/90">
              {messages.auth.brandLine}
            </p>
            <p className="text-[0.8125rem] text-muted">{messages.auth.brandFoot}</p>
          </div>
        </div>

        {/* Form panel */}
        <div className="relative flex items-center justify-center px-6 py-16">
          <Link href="/" className="absolute left-6 top-6 flex items-center gap-2 text-sm font-medium tracking-tight lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
              <Sparkles className="h-4 w-4" />
            </span>
            LifeOS
          </Link>
          <div className="absolute right-6 top-6">
            <LanguageSwitch />
          </div>
          {children}
        </div>
      </div>
    </LocaleProvider>
  );
}
