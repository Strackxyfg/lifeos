/**
 * Where the sun and the moon are, for an instant and a place.
 *
 * The hub's sky is the person's own: its light comes from the sun's real
 * position, so the plaza's shadows turn through the day, and the street lamps
 * come on at the actual dusk — in June in Paris near ten at night, in
 * December before five.
 *
 * Sun: NOAA's "General Solar Position Calculations" (Global Monitoring
 * Division), with its atmospheric refraction correction. About a minute of
 * accuracy on sunrise and sunset, far finer than a picture can show.
 * Moon: the low-precision series of the Astronomical Almanac (≈0.3°), with a
 * parallax correction, and its phase from the elongation to the sun.
 *
 * Angles are degrees at the edges (they are what people and tests read),
 * radians inside.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
/** J2000.0 as a Unix time, in milliseconds. */
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

export interface SkyBody {
  /** Degrees above the horizon; negative below. */
  elevation: number;
  /** Degrees clockwise from north. */
  azimuth: number;
}

export interface SunPosition extends SkyBody {
  /** Before solar noon: the morning half of the day. Dawn and dusk differ in colour. */
  rising: boolean;
  /** Degrees from solar noon, negative in the morning (15° an hour). */
  hourAngle: number;
}

export interface MoonPosition extends SkyBody {
  /** Fraction of the disc that is lit, 0 (new) to 1 (full). */
  illumination: number;
  /** Whether it is growing towards full. */
  waxing: boolean;
}

export interface SunTimes {
  /** Null during polar day or polar night. */
  sunrise: Date | null;
  sunset: Date | null;
  /** When the sun is highest. */
  noon: Date;
  /** Set when the sun never rises or never sets that day. */
  polar: "day" | "night" | null;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mod = (x: number, n: number) => ((x % n) + n) % n;

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** NOAA's fractional year γ, in radians, for a UTC instant. */
function fractionalYear(t: number): number {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const dayOfYear = Math.floor((t - Date.UTC(y, 0, 1)) / DAY_MS) + 1;
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  return ((2 * Math.PI) / (isLeapYear(y) ? 366 : 365)) * (dayOfYear - 1 + (hours - 12) / 24);
}

/** The equation of time (minutes) and the sun's declination (radians). */
function solarTerms(t: number): { eqTime: number; decl: number } {
  const g = fractionalYear(t);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  return { eqTime, decl };
}

/**
 * How much the atmosphere lifts a body near the horizon, in degrees (NOAA).
 * Half a degree at the horizon: the sun is seen whole a few minutes after it
 * has geometrically set.
 */
export function refraction(elevation: number): number {
  if (elevation > 85) return 0;
  const te = Math.tan(elevation * RAD);
  let arcsec: number;
  if (elevation > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevation > -0.575)
    arcsec = 1735 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)));
  else arcsec = -20.772 / te;
  return arcsec / 3600;
}

/** Altitude and azimuth from an hour angle and a declination (radians). */
function horizontal(hourAngle: number, decl: number, lat: number): SkyBody {
  const phi = lat * RAD;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  // Measured from the south, westward; turned into the usual clockwise-from-north.
  const fromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)
  );
  return { elevation: alt / RAD, azimuth: mod(fromSouth / RAD + 180, 360) };
}

/** The sun, as seen from (lat, lon) at `date`. */
export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const t = date.getTime();
  const { eqTime, decl } = solarTerms(t);
  const d = new Date(t);
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  // True solar time, then the hour angle: 0 at solar noon, negative in the morning.
  const trueSolar = utcMinutes + eqTime + 4 * lon;
  const hourAngleDeg = mod(trueSolar / 4, 360) - 180;
  const body = horizontal(hourAngleDeg * RAD, decl, lat);
  return {
    elevation: body.elevation + refraction(body.elevation),
    azimuth: body.azimuth,
    rising: hourAngleDeg < 0,
    hourAngle: hourAngleDeg,
  };
}

/**
 * Sunrise, sunset and solar noon for the day that contains `date` at this
 * longitude (the mean solar day — the same as the civil day except within
 * minutes of midnight, when nobody is asking).
 */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const meanLocal = date.getTime() + lon * 240_000;
  const dayStartUtc = Math.floor(meanLocal / DAY_MS) * DAY_MS;

  // Each event is solved twice: once with the day's terms, then again with
  // the terms at the first estimate — the declination moves during the day.
  const event = (which: "rise" | "set" | "noon"): { t: number; polar: SunTimes["polar"] } => {
    let t = dayStartUtc + 720 * 60_000 - lon * 240_000;
    let polar: SunTimes["polar"] = null;
    for (let i = 0; i < 2; i++) {
      const { eqTime, decl } = solarTerms(t);
      if (which === "noon") {
        t = dayStartUtc + (720 - 4 * lon - eqTime) * 60_000;
        continue;
      }
      const phi = lat * RAD;
      // 90.833°: the sun's upper limb on the horizon, refraction included.
      const cosH = Math.cos(90.833 * RAD) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
      if (cosH > 1) return { t: NaN, polar: "night" };
      if (cosH < -1) return { t: NaN, polar: "day" };
      const h = Math.acos(cosH) / RAD;
      const minutes = which === "rise" ? 720 - 4 * (lon + h) - eqTime : 720 - 4 * (lon - h) - eqTime;
      t = dayStartUtc + minutes * 60_000;
      polar = null;
    }
    return { t, polar };
  };

  const noon = event("noon");
  const rise = event("rise");
  const set = event("set");
  return {
    sunrise: Number.isNaN(rise.t) ? null : new Date(rise.t),
    sunset: Number.isNaN(set.t) ? null : new Date(set.t),
    noon: new Date(noon.t),
    polar: rise.polar ?? set.polar,
  };
}

/** The moon, as seen from (lat, lon) at `date`, with its phase. */
export function moonPosition(date: Date, lat: number, lon: number): MoonPosition {
  const d = (date.getTime() - J2000_MS) / DAY_MS;

  // Geocentric ecliptic coordinates of the moon (degrees).
  const L = 218.316 + 13.176396 * d;
  const M = 134.963 + 13.064993 * d;
  const F = 93.272 + 13.22935 * d;
  const lambda = L + 6.289 * Math.sin(M * RAD);
  const beta = 5.128 * Math.sin(F * RAD);

  // To equatorial, then to the local sky.
  const eps = 23.4397 * RAD;
  const lr = lambda * RAD;
  const br = beta * RAD;
  const ra = Math.atan2(Math.sin(lr) * Math.cos(eps) - Math.tan(br) * Math.sin(eps), Math.cos(lr));
  const dec = Math.asin(Math.sin(br) * Math.cos(eps) + Math.cos(br) * Math.sin(eps) * Math.sin(lr));
  const siderealDeg = 280.16 + 360.9856235 * d + lon;
  const body = horizontal(siderealDeg * RAD - ra, dec, lat);
  // The moon is close enough for its parallax to lower it by up to a degree.
  const topocentric = body.elevation - 0.9507 * Math.cos(body.elevation * RAD);

  // Phase: the angle between moon and sun, seen from the earth.
  const Ms = (357.5291 + 0.98560028 * d) * RAD;
  const C = 1.9148 * Math.sin(Ms) + 0.02 * Math.sin(2 * Ms) + 0.0003 * Math.sin(3 * Ms);
  const sunLambda = Ms / RAD + C + 180 + 102.9372;
  const cosElongation = Math.cos(br) * Math.cos((lambda - sunLambda) * RAD);

  return {
    elevation: topocentric + refraction(topocentric),
    azimuth: body.azimuth,
    illumination: (1 - cosElongation) / 2,
    waxing: mod(lambda - sunLambda, 360) < 180,
  };
}

/**
 * A direction in the scene for a body in the sky. The hub faces north: north
 * is −Z, east is +X, up is +Y — so the morning sun rises on the right of the
 * view and sets on the left, as it would for someone looking north.
 */
export function skyDirection(body: SkyBody): [number, number, number] {
  const e = body.elevation * RAD;
  const a = body.azimuth * RAD;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
