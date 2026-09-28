/**
 * Where to compute the sky for, without asking where the person is.
 *
 * The browser's time zone names a city ("Europe/Paris"); its coordinates are
 * close enough for the sun — Marseille's sunset is some ten minutes off
 * Paris's, invisible in a picture. No geolocation prompt, no network call,
 * nothing leaves the device. An unknown zone falls back on its UTC offset for
 * the longitude (15° an hour) and a temperate latitude, and says so.
 */

export interface Place {
  lat: number;
  lon: number;
  /** The city the sky is computed for, or null when it is only the offset. */
  city: string | null;
}

/** [latitude, longitude, city]. Zone aliases point at the same entry. */
const ZONES: Record<string, readonly [number, number, string]> = {
  "Europe/Paris": [48.86, 2.35, "Paris"],
  "Europe/Brussels": [50.85, 4.35, "Bruxelles"],
  "Europe/Luxembourg": [49.61, 6.13, "Luxembourg"],
  "Europe/Monaco": [43.73, 7.42, "Monaco"],
  "Europe/Zurich": [47.37, 8.54, "Zurich"],
  "Europe/London": [51.51, -0.13, "London"],
  "Europe/Dublin": [53.35, -6.26, "Dublin"],
  "Europe/Lisbon": [38.72, -9.14, "Lisboa"],
  "Europe/Madrid": [40.42, -3.7, "Madrid"],
  "Europe/Andorra": [42.51, 1.52, "Andorra"],
  "Europe/Rome": [41.9, 12.5, "Roma"],
  "Europe/Berlin": [52.52, 13.4, "Berlin"],
  "Europe/Amsterdam": [52.37, 4.9, "Amsterdam"],
  "Europe/Vienna": [48.21, 16.37, "Wien"],
  "Europe/Stockholm": [59.33, 18.07, "Stockholm"],
  "Europe/Oslo": [59.91, 10.75, "Oslo"],
  "Europe/Copenhagen": [55.68, 12.57, "København"],
  "Europe/Helsinki": [60.17, 24.94, "Helsinki"],
  "Europe/Warsaw": [52.23, 21.01, "Warszawa"],
  "Europe/Prague": [50.08, 14.44, "Praha"],
  "Europe/Budapest": [47.5, 19.04, "Budapest"],
  "Europe/Athens": [37.98, 23.73, "Athína"],
  "Europe/Bucharest": [44.43, 26.1, "București"],
  "Europe/Kyiv": [50.45, 30.52, "Kyiv"],
  "Europe/Istanbul": [41.01, 28.98, "İstanbul"],
  "Europe/Moscow": [55.76, 37.62, "Moskva"],
  "Atlantic/Reykjavik": [64.15, -21.94, "Reykjavík"],
  "Atlantic/Canary": [28.12, -15.43, "Las Palmas"],
  "America/New_York": [40.71, -74.01, "New York"],
  "America/Toronto": [43.65, -79.38, "Toronto"],
  "America/Montreal": [45.5, -73.57, "Montréal"],
  "America/Chicago": [41.88, -87.63, "Chicago"],
  "America/Denver": [39.74, -104.99, "Denver"],
  "America/Phoenix": [33.45, -112.07, "Phoenix"],
  "America/Los_Angeles": [34.05, -118.24, "Los Angeles"],
  "America/Vancouver": [49.28, -123.12, "Vancouver"],
  "America/Anchorage": [61.22, -149.9, "Anchorage"],
  "Pacific/Honolulu": [21.31, -157.86, "Honolulu"],
  "America/Mexico_City": [19.43, -99.13, "Ciudad de México"],
  "America/Bogota": [4.71, -74.07, "Bogotá"],
  "America/Lima": [-12.05, -77.04, "Lima"],
  "America/Santiago": [-33.45, -70.67, "Santiago"],
  "America/Sao_Paulo": [-23.55, -46.63, "São Paulo"],
  "America/Argentina/Buenos_Aires": [-34.6, -58.38, "Buenos Aires"],
  "America/Caracas": [10.48, -66.9, "Caracas"],
  "America/Port-au-Prince": [18.54, -72.34, "Port-au-Prince"],
  "America/Martinique": [14.6, -61.07, "Fort-de-France"],
  "America/Guadeloupe": [16.24, -61.53, "Pointe-à-Pitre"],
  "America/Cayenne": [4.92, -52.31, "Cayenne"],
  "America/Miquelon": [47.1, -56.38, "Saint-Pierre"],
  "Africa/Casablanca": [33.57, -7.59, "Casablanca"],
  "Africa/Algiers": [36.75, 3.06, "Alger"],
  "Africa/Tunis": [36.81, 10.18, "Tunis"],
  "Africa/Cairo": [30.04, 31.24, "Le Caire"],
  "Africa/Dakar": [14.72, -17.47, "Dakar"],
  "Africa/Abidjan": [5.36, -4.01, "Abidjan"],
  "Africa/Bamako": [12.64, -8.0, "Bamako"],
  "Africa/Ouagadougou": [12.37, -1.52, "Ouagadougou"],
  "Africa/Lome": [6.13, 1.22, "Lomé"],
  "Africa/Porto-Novo": [6.5, 2.6, "Porto-Novo"],
  "Africa/Niamey": [13.51, 2.11, "Niamey"],
  "Africa/Conakry": [9.64, -13.58, "Conakry"],
  "Africa/Douala": [4.05, 9.77, "Douala"],
  "Africa/Libreville": [0.42, 9.47, "Libreville"],
  "Africa/Kinshasa": [-4.44, 15.27, "Kinshasa"],
  "Africa/Brazzaville": [-4.26, 15.24, "Brazzaville"],
  "Africa/Lagos": [6.52, 3.38, "Lagos"],
  "Africa/Nairobi": [-1.29, 36.82, "Nairobi"],
  "Africa/Johannesburg": [-26.2, 28.05, "Johannesburg"],
  "Indian/Antananarivo": [-18.88, 47.51, "Antananarivo"],
  "Indian/Reunion": [-20.88, 55.45, "Saint-Denis"],
  "Indian/Mauritius": [-20.16, 57.5, "Port-Louis"],
  "Indian/Mayotte": [-12.78, 45.23, "Mamoudzou"],
  "Asia/Dubai": [25.2, 55.27, "Dubai"],
  "Asia/Riyadh": [24.71, 46.68, "Riyadh"],
  "Asia/Qatar": [25.29, 51.53, "Doha"],
  "Asia/Beirut": [33.89, 35.5, "Beyrouth"],
  "Asia/Jerusalem": [31.77, 35.21, "Jerusalem"],
  "Asia/Tehran": [35.69, 51.39, "Tehran"],
  "Asia/Karachi": [24.86, 67.01, "Karachi"],
  "Asia/Kolkata": [22.57, 88.36, "Kolkata"],
  "Asia/Dhaka": [23.81, 90.41, "Dhaka"],
  "Asia/Bangkok": [13.76, 100.5, "Bangkok"],
  "Asia/Ho_Chi_Minh": [10.82, 106.63, "Hô Chi Minh-Ville"],
  "Asia/Singapore": [1.35, 103.82, "Singapore"],
  "Asia/Jakarta": [-6.21, 106.85, "Jakarta"],
  "Asia/Manila": [14.6, 120.98, "Manila"],
  "Asia/Shanghai": [31.23, 121.47, "Shanghai"],
  "Asia/Hong_Kong": [22.32, 114.17, "Hong Kong"],
  "Asia/Taipei": [25.03, 121.57, "Taipei"],
  "Asia/Seoul": [37.57, 126.98, "Seoul"],
  "Asia/Tokyo": [35.68, 139.69, "Tokyo"],
  "Australia/Perth": [-31.95, 115.86, "Perth"],
  "Australia/Adelaide": [-34.93, 138.6, "Adelaide"],
  "Australia/Brisbane": [-27.47, 153.03, "Brisbane"],
  "Australia/Sydney": [-33.87, 151.21, "Sydney"],
  "Australia/Melbourne": [-37.81, 144.96, "Melbourne"],
  "Pacific/Auckland": [-36.85, 174.76, "Auckland"],
  "Pacific/Noumea": [-22.27, 166.46, "Nouméa"],
  "Pacific/Tahiti": [-17.54, -149.57, "Papeete"],
};

/** Older names the browsers still report. */
const ALIASES: Record<string, string> = {
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Europe/Belfast": "Europe/London",
  "US/Eastern": "America/New_York",
  "US/Central": "America/Chicago",
  "US/Mountain": "America/Denver",
  "US/Pacific": "America/Los_Angeles",
};

/**
 * The place for a time zone. `offsetMinutes` is the zone's current offset
 * east of UTC (the opposite sign of `Date#getTimezoneOffset`), used only when
 * the zone is not one this table knows.
 */
export function placeFromTimeZone(zone: string | undefined, offsetMinutes: number): Place {
  const key = zone ? (ALIASES[zone] ?? zone) : undefined;
  const hit = key ? ZONES[key] : undefined;
  if (hit) return { lat: hit[0], lon: hit[1], city: hit[2] };
  const southern = !!zone && /^(Australia|Antarctica)\//.test(zone);
  return {
    lat: southern ? -30 : 40,
    lon: Math.max(-180, Math.min(180, offsetMinutes / 4)),
    city: null,
  };
}

/** The place for this browser, right now. */
export function currentPlace(): Place {
  let zone: string | undefined;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    zone = undefined;
  }
  return placeFromTimeZone(zone, -new Date().getTimezoneOffset());
}
