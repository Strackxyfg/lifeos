/**
 * French business identifiers and bank details, checked the way the
 * administration and the banks check them — so a typo is caught when it is
 * typed, not when a client's accountant rejects the invoice.
 */

const digits = (s: string) => s.replace(/[\s.-]/g, "");

/** The Luhn check, on a string of digits. */
export function luhn(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < value.length; i++) {
    let d = Number(value[value.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** A SIREN: nine digits passing the Luhn check. Spaces and dots are ignored. */
export function isSiren(raw: string): boolean {
  const v = digits(raw);
  return /^\d{9}$/.test(v) && luhn(v);
}

/**
 * A SIRET: fourteen digits passing the Luhn check, the first nine a SIREN.
 * La Poste's establishments (SIREN 356 000 000) follow their own rule: the
 * sum of the digits is a multiple of 5.
 */
export function isSiret(raw: string): boolean {
  const v = digits(raw);
  if (!/^\d{14}$/.test(v)) return false;
  if (v.startsWith("356000000")) return [...v].reduce((s, d) => s + Number(d), 0) % 5 === 0;
  return luhn(v) && isSiren(v.slice(0, 9));
}

/** The SIREN inside a SIRET, a French VAT number, or a SIREN itself. */
export function sirenOf(raw: string): string | null {
  const v = digits(raw).toUpperCase();
  if (/^\d{9}$/.test(v)) return v;
  if (/^\d{14}$/.test(v)) return v.slice(0, 9);
  if (/^FR[0-9A-Z]{2}\d{9}$/.test(v)) return v.slice(4);
  return null;
}

/**
 * A French intra-community VAT number: "FR", a two-character key, the
 * SIREN. A numeric key must equal (12 + 3 × (SIREN mod 97)) mod 97; the rare
 * alphanumeric keys cannot be checked offline and are accepted as written.
 */
export function isFrenchVat(raw: string): boolean {
  const v = digits(raw).toUpperCase();
  const m = v.match(/^FR([0-9A-Z]{2})(\d{9})$/);
  if (!m || !isSiren(m[2])) return false;
  if (!/^\d{2}$/.test(m[1])) return true;
  return Number(m[1]) === (12 + 3 * (Number(m[2]) % 97)) % 97;
}

/** The VAT number a French SIREN gets. */
export function frenchVatOf(siren: string): string | null {
  const v = digits(siren);
  if (!isSiren(v)) return null;
  const key = (12 + 3 * (Number(v) % 97)) % 97;
  return `FR${String(key).padStart(2, "0")}${v}`;
}

/** An intra-community VAT number of another EU country: two letters and 2 to 13 characters (not checked further offline). */
export function isEuVat(raw: string): boolean {
  const v = digits(raw).toUpperCase();
  if (v.startsWith("FR")) return isFrenchVat(v);
  return /^(AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[0-9A-Z]{2,13}$/.test(v);
}

/** Lengths of IBANs by country, for the countries a French business meets most. */
const IBAN_LENGTH: Record<string, number> = {
  FR: 27, MC: 27, DE: 22, BE: 16, ES: 24, IT: 27, LU: 20, NL: 18, PT: 25, CH: 21, GB: 22, IE: 22, AT: 20, DK: 18, FI: 18, SE: 24, NO: 15, PL: 28,
};

/** An IBAN: country, check digits, account — the check digits verified (ISO 13616, mod 97). */
export function isIban(raw: string): boolean {
  const v = raw.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return false;
  const expected = IBAN_LENGTH[v.slice(0, 2)];
  if (expected && v.length !== expected) return false;
  const moved = v.slice(4) + v.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const n = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of n) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** An IBAN as it is printed: groups of four. */
export function formatIban(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase().replace(/(.{4})/g, "$1 ").trim();
}

/** A SIREN or SIRET as it is printed: 123 456 789 / 123 456 789 00012. */
export function formatSiren(raw: string): string {
  const v = digits(raw);
  if (v.length === 9) return `${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)}`;
  if (v.length === 14) return `${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6, 9)} ${v.slice(9)}`;
  return raw.trim();
}
