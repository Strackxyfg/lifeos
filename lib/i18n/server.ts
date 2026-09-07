import { cookies } from "next/headers";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "./config";
import { dictionaries, type Messages } from "./dictionaries";

/** Current locale from the cookie (server components / actions / routes). */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : defaultLocale;
}

export async function getMessages(): Promise<Messages> {
  return dictionaries[await getLocale()];
}
