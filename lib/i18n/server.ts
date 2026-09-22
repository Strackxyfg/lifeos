import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "./config";
import { dictionaries, type Messages } from "./dictionaries";

/**
 * Current locale (server components / actions / routes): the person's choice
 * from the cookie, or — before they have made one — their browser's first
 * preference. A French visitor used to land on an English page and had to
 * find the switch.
 */
export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(v)) return v;
  const first = ((await headers()).get("accept-language") ?? "").split(",")[0]?.trim().slice(0, 2).toLowerCase();
  return isLocale(first) ? first : defaultLocale;
}

export async function getMessages(): Promise<Messages> {
  return dictionaries[await getLocale()];
}
