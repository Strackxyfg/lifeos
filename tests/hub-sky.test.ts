import { describe, it, expect } from "vitest";
import { moonPosition, refraction, skyDirection, sunPosition, sunTimes } from "@/lib/hub/solar";
import { placeFromTimeZone } from "@/lib/hub/place";
import { linear, phaseOf, skyState, toHex } from "@/lib/hub/sky";

const PARIS = { lat: 48.86, lon: 2.35 };
const minutesApart = (a: Date | null, b: Date) => (a ? Math.abs(a.getTime() - b.getTime()) / 60_000 : Infinity);

describe("the sun, where it really is", () => {
  it("rises and sets in Paris at the published times, solstice to solstice", () => {
    // Summer solstice: 05:47 and 21:58 in Paris (CEST, UTC+2).
    const june = sunTimes(new Date("2026-06-21T12:00:00Z"), PARIS.lat, PARIS.lon);
    expect(minutesApart(june.sunrise, new Date("2026-06-21T03:47:00Z"))).toBeLessThan(4);
    expect(minutesApart(june.sunset, new Date("2026-06-21T19:58:00Z"))).toBeLessThan(4);
    // Winter solstice: 08:42 and 16:56 (CET, UTC+1).
    const december = sunTimes(new Date("2026-12-21T12:00:00Z"), PARIS.lat, PARIS.lon);
    expect(minutesApart(december.sunrise, new Date("2026-12-21T07:42:00Z"))).toBeLessThan(4);
    expect(minutesApart(december.sunset, new Date("2026-12-21T15:56:00Z"))).toBeLessThan(4);
    expect(june.polar).toBeNull();
  });

  it("gets the other hemisphere and the other side of the date line right", () => {
    // Sydney, 21 December: 05:41 and 20:05 local (AEDT, UTC+11).
    const sydney = sunTimes(new Date("2026-12-21T02:00:00Z"), -33.87, 151.21);
    expect(minutesApart(sydney.sunrise, new Date("2026-12-20T18:41:00Z"))).toBeLessThan(5);
    expect(minutesApart(sydney.sunset, new Date("2026-12-21T09:05:00Z"))).toBeLessThan(5);
    // New York, 21 June: 05:25 and 20:31 local (EDT, UTC−4).
    const ny = sunTimes(new Date("2026-06-21T16:00:00Z"), 40.71, -74.01);
    expect(minutesApart(ny.sunrise, new Date("2026-06-21T09:25:00Z"))).toBeLessThan(5);
    expect(minutesApart(ny.sunset, new Date("2026-06-22T00:31:00Z"))).toBeLessThan(5);
  });

  it("knows the polar night and the midnight sun", () => {
    const tromso = { lat: 69.65, lon: 18.96 };
    const winter = sunTimes(new Date("2026-12-21T11:00:00Z"), tromso.lat, tromso.lon);
    expect(winter).toMatchObject({ sunrise: null, sunset: null, polar: "night" });
    const summer = sunTimes(new Date("2026-06-21T11:00:00Z"), tromso.lat, tromso.lon);
    expect(summer).toMatchObject({ sunrise: null, sunset: null, polar: "day" });
    // At midnight in June the sun is still above the horizon there.
    expect(sunPosition(new Date("2026-06-21T22:40:00Z"), tromso.lat, tromso.lon).elevation).toBeGreaterThan(0);
  });

  it("stands as high as geometry says at noon, due south", () => {
    const june = sunTimes(new Date("2026-06-21T12:00:00Z"), PARIS.lat, PARIS.lon);
    const noon = sunPosition(june.noon, PARIS.lat, PARIS.lon);
    // 90° − latitude + the tilt of the earth (23.44°).
    expect(noon.elevation).toBeCloseTo(90 - PARIS.lat + 23.44, 0);
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(1);
    expect(Math.abs(noon.hourAngle)).toBeLessThan(0.5);
    // Equinox on the equator: nearly overhead.
    const eq = sunTimes(new Date("2026-03-20T12:00:00Z"), 0, 0);
    expect(sunPosition(eq.noon, 0, 0).elevation).toBeGreaterThan(88.5);
  });

  it("rises in the north-east and sets in the north-west in June", () => {
    const june = sunTimes(new Date("2026-06-21T12:00:00Z"), PARIS.lat, PARIS.lon);
    const rise = sunPosition(june.sunrise!, PARIS.lat, PARIS.lon);
    const set = sunPosition(june.sunset!, PARIS.lat, PARIS.lon);
    expect(rise.azimuth).toBeGreaterThan(45);
    expect(rise.azimuth).toBeLessThan(60);
    expect(set.azimuth).toBeGreaterThan(300);
    expect(set.azimuth).toBeLessThan(315);
    // At the published sunrise the sun's upper edge is on the horizon, refraction included.
    expect(Math.abs(rise.elevation + 0.833 - 0.57)).toBeLessThan(0.6);
    expect(rise.rising).toBe(true);
    expect(set.rising).toBe(false);
  });

  it("refracts most at the horizon and not at all overhead", () => {
    expect(refraction(0)).toBeGreaterThan(0.45);
    expect(refraction(0)).toBeLessThan(0.55);
    expect(refraction(45)).toBeLessThan(0.02);
    expect(refraction(89)).toBe(0);
  });

  it("points the scene the way the sky goes: east on the right, north ahead", () => {
    const east = skyDirection({ elevation: 0, azimuth: 90 });
    expect(east[0]).toBeCloseTo(1, 5);
    const north = skyDirection({ elevation: 0, azimuth: 0 });
    expect(north[2]).toBeCloseTo(-1, 5);
    const up = skyDirection({ elevation: 90, azimuth: 123 });
    expect(up[1]).toBeCloseTo(1, 5);
  });
});

describe("the moon", () => {
  it("is full on the night of the March 2026 lunar eclipse, new at the August solar one", () => {
    expect(moonPosition(new Date("2026-03-03T11:33:00Z"), PARIS.lat, PARIS.lon).illumination).toBeGreaterThan(0.97);
    expect(moonPosition(new Date("2026-08-12T17:46:00Z"), PARIS.lat, PARIS.lon).illumination).toBeLessThan(0.03);
  });

  it("waxes after the new moon and wanes after the full", () => {
    expect(moonPosition(new Date("2026-08-17T12:00:00Z"), PARIS.lat, PARIS.lon).waxing).toBe(true);
    expect(moonPosition(new Date("2026-03-08T12:00:00Z"), PARIS.lat, PARIS.lon).waxing).toBe(false);
  });

  it("is opposite the sun when full", () => {
    const at = new Date("2026-03-03T11:33:00Z");
    const moon = skyDirection(moonPosition(at, PARIS.lat, PARIS.lon));
    const sun = skyDirection(sunPosition(at, PARIS.lat, PARIS.lon));
    const dot = moon[0] * sun[0] + moon[1] * sun[1] + moon[2] * sun[2];
    expect(dot).toBeLessThan(-0.95);
  });
});

describe("the place, from the time zone alone", () => {
  it("finds the city of a known zone and its aliases", () => {
    expect(placeFromTimeZone("Europe/Paris", 120)).toEqual({ lat: 48.86, lon: 2.35, city: "Paris" });
    expect(placeFromTimeZone("Asia/Calcutta", 330).city).toBe("Kolkata");
    expect(placeFromTimeZone("Indian/Reunion", 240).city).toBe("Saint-Denis");
  });

  it("falls back on the offset for the longitude, and says it has no city", () => {
    const place = placeFromTimeZone("Etc/GMT-3", 180);
    expect(place).toEqual({ lat: 40, lon: 45, city: null });
    expect(placeFromTimeZone(undefined, -300).lon).toBe(-75);
    expect(placeFromTimeZone("Australia/Lord_Howe", 660).lat).toBeLessThan(0);
  });
});

describe("the light of the hub", () => {
  const sun = (elevation: number, rising = false, hourAngle = rising ? -60 : 60) => ({
    elevation,
    azimuth: 180,
    rising,
    hourAngle,
  });

  it("names the moment of the day from the sun", () => {
    expect(phaseOf(sun(-20))).toBe("night");
    expect(phaseOf(sun(-3, true))).toBe("dawn");
    expect(phaseOf(sun(-3, false))).toBe("dusk");
    expect(phaseOf(sun(2, true))).toBe("sunrise");
    expect(phaseOf(sun(2, false))).toBe("sunset");
    expect(phaseOf(sun(9, false))).toBe("golden");
    expect(phaseOf(sun(40, false, 8))).toBe("noon");
    expect(phaseOf(sun(40, false, 50))).toBe("afternoon");
    expect(phaseOf(sun(40, true, -50))).toBe("morning");
  });

  it("switches the lamps on as the sun goes down, and only then", () => {
    let previous = -1;
    for (let e = 40; e >= -20; e -= 0.5) {
      const lamps = skyState(sun(e)).lamps;
      expect(lamps).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = lamps;
    }
    expect(skyState(sun(30)).lamps).toBe(0);
    expect(skyState(sun(-8)).lamps).toBe(1);
    expect(skyState(sun(30)).sunIntensity).toBeGreaterThan(2);
    expect(skyState(sun(-2)).sunIntensity).toBe(0);
    expect(skyState(sun(-19)).stars).toBe(1);
    expect(skyState(sun(20)).stars).toBe(0);
  });

  it("never jumps: a tenth of a degree changes the light by very little", () => {
    const channels = (e: number) => {
      const s = skyState(sun(e));
      return [...s.zenith, ...s.horizon, ...s.sunColor, ...s.waterDeep, s.sunIntensity / 3, s.lamps];
    };
    for (let e = -25; e <= 60; e += 0.1) {
      const a = channels(e);
      const b = channels(e + 0.1);
      const worst = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      expect(worst, `at ${e.toFixed(1)}°`).toBeLessThan(0.03);
    }
  });

  it("colours dawn and dusk differently at the same height", () => {
    expect(skyState(sun(-2, true)).horizon).not.toEqual(skyState(sun(-2, false)).horizon);
    expect(skyState(sun(30, true)).horizon).toEqual(skyState(sun(30, false)).horizon);
  });

  it("lets a bright full moon light the night, not a new one or one below the horizon", () => {
    const night = sun(-30);
    const full = { elevation: 40, azimuth: 150, illumination: 1, waxing: false };
    expect(skyState(night, full).moonIntensity).toBeGreaterThan(0.3);
    expect(skyState(night, { ...full, illumination: 0 }).moonIntensity).toBeLessThan(0.1);
    expect(skyState(night, { ...full, elevation: -5 }).moonIntensity).toBe(0);
    expect(skyState(sun(40), full).moonIntensity).toBe(0);
  });

  it("round-trips colours between sRGB and linear light", () => {
    for (const hex of ["#000000", "#ffffff", "#3f84d6", "#f39458", "#0e1630"]) {
      expect(toHex(linear(hex))).toBe(hex);
    }
  });
});
