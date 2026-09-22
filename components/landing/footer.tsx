"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useMessages } from "@/lib/i18n/client";

/**
 * Only links that lead somewhere. The footer used to list Changelog, Blog,
 * Careers, Docs, Templates, Status, a DPA and more — all pointing at "#" —
 * next to an "All systems operational" light that measured nothing.
 */
export function Footer() {
  const m = useMessages();
  const t = m.landing;

  const columns = [
    {
      title: t.footer.product,
      links: [
        { label: t.nav.how, href: "#how" },
        { label: t.nav.features, href: "#features" },
        { label: t.nav.pricing, href: "#pricing" },
        { label: t.nav.faq, href: "#faq" },
      ],
    },
    {
      title: t.footer.account,
      links: [
        { label: t.nav.signIn, href: "/login" },
        { label: m.auth.createLink, href: "/signup" },
      ],
    },
  ];

  return (
    <footer className="border-t border-border">
      <div className="container max-w-content py-16">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-2 font-medium tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
                <Sparkles className="h-4 w-4" />
              </span>
              LifeOS
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">{t.footer.tagline}</p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            {columns.map((col) => (
              <div key={col.title}>
                <h4 className="text-[0.8125rem] font-medium">{col.title}</h4>
                <ul className="mt-4 flex flex-col gap-2.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <a href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 border-t border-border pt-8 text-sm text-muted">
          <p>© {new Date().getFullYear()} LifeOS</p>
        </div>
      </div>
    </footer>
  );
}
