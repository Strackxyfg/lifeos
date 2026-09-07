"use client";

import { createContext, useContext } from "react";
import type { Locale } from "./config";
import type { Messages } from "./dictionaries";

const LocaleContext = createContext<{ locale: Locale; m: Messages } | null>(null);

export function LocaleProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={{ locale, m: messages }}>{children}</LocaleContext.Provider>;
}

function useCtx() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useMessages/useLocale must be used within <LocaleProvider>");
  return ctx;
}

export function useMessages(): Messages {
  return useCtx().m;
}

export function useLocale(): Locale {
  return useCtx().locale;
}
