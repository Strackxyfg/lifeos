"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Command, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/content/site";
import { buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50"
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-content items-center justify-between px-6 transition-colors duration-300",
          scrolled && "glass border-b border-border"
        )}
      >
        <Link href="/" className="flex items-center gap-2 font-medium tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
            <Sparkles className="h-4 w-4" />
          </span>
          LifeOS
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {site.nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.dispatchEvent(new Event("lifeos:command"))}
            className="hidden items-center gap-2 rounded-md border border-border bg-surface/60 px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground sm:flex"
            aria-label="Open command menu"
          >
            <Command className="h-3.5 w-3.5" />
            <Kbd>⌘K</Kbd>
          </button>
          <a
            href="/login"
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "max-sm:hidden")}
          >
            Sign in
          </a>
          <a href="/signup" className={buttonVariants({ size: "sm" })}>
            Get early access
          </a>
        </div>
      </div>
    </motion.header>
  );
}
