"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { LayoutGrid } from "lucide-react";
import { useLocale, useMessages } from "@/lib/i18n/client";
import { fill, plural } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import { DISTRICTS, districtById, isDistrictId, neighbour, type DistrictId } from "@/lib/hub/districts";
import { currentPlace, type Place } from "@/lib/hub/place";
import { deviceHints, initialTier, webglAvailable, type Tier } from "@/lib/hub/perf";
import { freeArea, overviewBand, type Band, type PageRect, type ScreenRect } from "@/lib/hub/framing";
import { pacer } from "./pacer-store";
import { sunPosition, sunTimes, moonPosition } from "@/lib/hub/solar";
import { skyState, toHex } from "@/lib/hub/sky";
import { hubBadges, type HubFacts } from "@/lib/hub/summary";
import type { Alert } from "@/lib/data/alerts";
import type { Profile } from "@/lib/user/profile";
import type { CameraGoal } from "./scene/camera-rig";
import type { PinLabel } from "./scene/pins";
import type { HubSceneApi } from "./hub-scene";
import { FocusPanel, HubCards, HubFallback, HubTopBar, PhotoButton, PhotoPanel, SkyChip, type PhotoState } from "./hub-hud";

const HubScene = dynamic(() => import("./hub-scene"), { ssr: false });

/** Where "enter" leaves a note for the way back, and "where you were" reads. */
const RETURN_KEY = "lifeos:hub:return";
const RESUME_KEY = "lifeos:hub:resume";
/** Coming back later than this is a new visit, not a return. */
const RETURN_WINDOW_MS = 30 * 60_000;

function readSession<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: the way back is a nicety, not a need.
  }
}

function greetingFor(hour: number): "night" | "morning" | "afternoon" | "evening" {
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function isTyping(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === "INPUT" || n.tagName === "TEXTAREA" || n.tagName === "SELECT" || n.isContentEditable);
}

/**
 * The hub: LifeOS's home, an island where each building is a part of the
 * product. Hover a building, click it: the camera flies to it and its panel
 * opens — real figures from the person's data, and a door. "Enter" pushes the
 * camera to that door and opens the page; coming back, the camera starts in
 * front of the building left, then pulls out over the island.
 *
 * The sky is the person's: the sun and moon at their real positions for the
 * time zone's city, so the island goes through dawn, noon, golden hour, dusk
 * and a lamp-lit night with them.
 */
export function Hub({ facts, profile, alerts }: { facts: HubFacts; profile: Profile; alerts: Alert[] }) {
  const m = useMessages();
  const locale = useLocale();
  const router = useRouter();

  // Everything that depends on the device is decided after mount: the server
  // cannot know the time zone, the GPU or the motion preference.
  const [mounted, setMounted] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [tier, setTier] = useState<Tier>("medium");
  const [tierPinned, setTierPinned] = useState(false);
  const [webgl, setWebgl] = useState(true);
  const [lost, setLost] = useState(false);
  const [sceneKey, setSceneKey] = useState(0);
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const [returnFrom, setReturnFrom] = useState<DistrictId | null>(null);
  const [resume, setResume] = useState<DistrictId | null>(null);

  const [now, setNow] = useState(() => new Date());
  const [previewMinutes, setPreviewMinutes] = useState<number | null>(null);
  const [goal, setGoal] = useState<CameraGoal>({ kind: "overview" });
  const [hovered, setHovered] = useState<DistrictId | null>(null);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setPlace(currentPlace());
    setTier(initialTier(deviceHints()));
    setWebgl(webglAvailable());
    const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(motionQuery.matches);
    const onMotion = () => setReducedMotion(motionQuery.matches);
    motionQuery.addEventListener("change", onMotion);
    setCoarse(matchMedia("(pointer: coarse)").matches);

    const back = readSession<{ id: string; at: number }>(RETURN_KEY);
    if (back && isDistrictId(back.id) && Date.now() - back.at < RETURN_WINDOW_MS) setReturnFrom(back.id);
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch {
      // ignore
    }
    const last = readSession<{ id: string }>(RESUME_KEY);
    if (last && isDistrictId(last.id)) setResume(last.id);
    // `?at=21:30` opens the island at that hour — to show someone the night at noon.
    const params = new URLSearchParams(window.location.search);
    const at = params.get("at")?.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (at) setPreviewMinutes(Number(at[1]) * 60 + Number(at[2]));
    // `?quality=high` pins the rendering quality: no automatic step down.
    const quality = params.get("quality");
    if (quality === "high" || quality === "medium" || quality === "low") {
      setTier(quality);
      setTierPinned(true);
    }
    setMounted(true);
    return () => motionQuery.removeEventListener("change", onMotion);
  }, []);

  // The real clock, twice a minute: the sun moves a quarter of a degree a minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const time = useMemo(() => {
    if (previewMinutes === null) return now;
    const d = new Date(now);
    d.setHours(Math.floor(previewMinutes / 60), previewMinutes % 60, 0, 0);
    return d;
  }, [now, previewMinutes]);

  const sky = useMemo(() => {
    if (!place) return null;
    const sun = sunPosition(time, place.lat, place.lon);
    return { sun, state: skyState(sun, moonPosition(time, place.lat, place.lon)), times: sunTimes(time, place.lat, place.lon) };
  }, [time, place]);

  const focused = goal.kind === "overview" ? null : goal.id;
  const entering = goal.kind === "enter";

  /* ── What the page's own panels cover ──────────────────────────── */

  // A building is framed in the part of the screen its panel and the
  // heads-up display leave free — measured, not guessed: a sheet on a small
  // phone covers more than one on a large phone.
  const rootRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [free, setFree] = useState<ScreenRect | null>(null);
  const [band, setBand] = useState<Band | null>(null);
  const onPanelLayout = useCallback((panel: PageRect | null) => {
    const root = rootRef.current;
    if (!panel || !root) return setFree(null);
    const hud = hudRef.current;
    // The sky chip's row is the lowest part of the heads-up display; hidden
    // (a phone, a building open), the top bar is.
    const hudBottom = hud?.offsetParent ? hud.offsetTop + hud.offsetHeight : 60;
    setFree(freeArea({ width: root.clientWidth, height: root.clientHeight }, hudBottom, panel));
  }, []);

  /* ── Photo mode ────────────────────────────────────────────────── */

  const [photo, setPhoto] = useState(false);
  const [photoState, setPhotoState] = useState<PhotoState>({ phase: "preparing", samples: 0, target: 0 });
  const sceneApi = useRef<HubSceneApi | null>(null);
  // Path tracing needs the post pipeline (every tier but the lowest) and a drawn island.
  const canPhoto = mounted && webgl && !lost && !!place && ready && tier !== "low";
  const endPhoto = useCallback(() => setPhoto(false), []);
  const savePhoto = useCallback(async () => {
    const blob = await sceneApi.current?.snapshot();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    a.href = url;
    a.download = fill(m.hub.photo.file, { time: stamp });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [m]);
  // A lost context or a quality drop to the lowest tier ends a photo.
  useEffect(() => {
    if (photo && !canPhoto) setPhoto(false);
  }, [photo, canPhoto]);

  /* ── Moving around ─────────────────────────────────────────────── */

  const focus = useCallback(
    (id: DistrictId) => {
      if (entering) return;
      setGoal({ kind: "focus", id });
      setHovered(null);
      router.prefetch(districtById(id).href);
    },
    [entering, router]
  );

  const backToIsland = useCallback(() => {
    if (entering) return;
    setGoal({ kind: "overview" });
  }, [entering]);

  const step = useCallback(
    (dir: 1 | -1) => {
      const from = focused ?? resume ?? DISTRICTS[DISTRICTS.length - 1].id;
      focus(focused ? neighbour(from, dir) : dir === 1 ? DISTRICTS[0].id : from);
    },
    [focused, resume, focus]
  );

  const enter = useCallback(
    (id: DistrictId) => {
      if (entering) return;
      const href = districtById(id).href;
      writeSession(RETURN_KEY, { id, at: Date.now() });
      writeSession(RESUME_KEY, { id });
      if (reducedMotion || !webgl || lost) {
        router.push(href);
        return;
      }
      setGoal({ kind: "enter", id });
      // The page fades to the app's background as the camera reaches the door.
      setTimeout(() => setFading(true), 380);
    },
    [entering, reducedMotion, webgl, lost, router]
  );

  const onArrive = useCallback(
    (g: CameraGoal) => {
      if (g.kind === "enter") router.push(districtById(g.id).href);
    },
    [router]
  );

  // Safety net: if the flight never reports arriving (a hidden tab pauses
  // frames), still go through the door.
  useEffect(() => {
    if (goal.kind !== "enter") return;
    const href = districtById(goal.id).href;
    const t = setTimeout(() => router.push(href), 2200);
    return () => clearTimeout(t);
  }, [goal, router]);

  // Keyboard: arrows walk, Enter goes in, Escape steps back; P takes a photo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      pacer.markActive();
      // A photo in progress: Escape (or any move) ends it first.
      if (photo) {
        if (e.key === "Escape" || e.key.startsWith("Arrow") || e.key === "Enter") {
          e.preventDefault();
          setPhoto(false);
        }
        return;
      }
      if ((e.key === "p" || e.key === "P") && canPhoto && !entering) {
        e.preventDefault();
        setPhoto(true);
        return;
      }
      if (document.querySelector('[role="dialog"][aria-modal="true"], [role="dialog"][aria-label]:not(#hub-panel)')) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        step(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      } else if (e.key === "Escape" && focused && !entering) {
        e.preventDefault();
        backToIsland();
      } else if (e.key === "Enter" && goal.kind === "focus") {
        // A focused button handles its own Enter.
        if ((e.target as HTMLElement | null)?.tagName === "BUTTON") return;
        e.preventDefault();
        enter(goal.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, focused, entering, backToIsland, goal, enter, photo, canPhoto]);

  // A pointer on a building shows it can be opened.
  useEffect(() => {
    document.body.style.cursor = hovered && !entering ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered, entering]);

  // A click on the sea or the plaza — not the end of a drag — closes a building.
  const down = useRef<{ x: number; y: number } | null>(null);
  const onBackground = useCallback(() => {
    if (goal.kind === "focus") backToIsland();
  }, [goal.kind, backToIsland]);

  /* ── What the scene shows ──────────────────────────────────────── */

  const signs = useMemo(
    () => Object.fromEntries(DISTRICTS.map((d) => [d.id, m.hub.districts[d.id].sign])) as Record<DistrictId, string>,
    [m]
  );
  const badges = useMemo(() => hubBadges(facts), [facts]);
  const pinLabels = useMemo(
    () =>
      Object.fromEntries(
        DISTRICTS.map((d) => {
          const name = m.hub.districts[d.id].name;
          const n = badges[d.id] ?? 0;
          return [d.id, { name, aria: n > 0 ? `${name} — ${plural(locale, n, m.hub.waiting)}` : name }];
        })
      ) as Record<DistrictId, PinLabel>,
    [m, badges, locale]
  );

  const onContextLost = useCallback(() => setLost(true), []);
  const onReady = useCallback(() => {
    // For measuring the load (navigation → an island on screen), in the field and in benches.
    performance.mark("hub:ready");
    setReady(true);
  }, []);

  const skyGradient = sky
    ? `linear-gradient(to bottom, ${toHex(sky.state.zenith)} 0%, ${toHex(sky.state.horizon)} 62%, ${toHex(sky.state.waterDeep)} 100%)`
    : "hsl(var(--background))";
  const greeting = m.hub.greeting[greetingFor(now.getHours())];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const show3d = mounted && webgl && !lost && !!place;

  // The island's band: below the top bar (with room for the markers above
  // the roofs), above the cards. Only ever narrower than the usual band — a
  // phone turned sideways, a short window.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !show3d) return;
    const measure = () => {
      const bar = root.querySelector<HTMLElement>("[data-hub-bar]");
      const barBottom = bar ? bar.getBoundingClientRect().bottom - root.getBoundingClientRect().top : 60;
      const cards = cardsRef.current;
      const first = cards?.firstElementChild as HTMLElement | null | undefined;
      const cardsTop = cards && first ? cards.offsetTop + first.offsetTop : null;
      const next = overviewBand({ height: root.clientHeight }, barBottom, cardsTop);
      setBand((b) => (b && Math.abs(b.top - next.top) < 0.01 && Math.abs(b.bottom - next.bottom) < 0.01 ? b : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    if (cardsRef.current) ro.observe(cardsRef.current);
    return () => ro.disconnect();
  }, [show3d]);
  const layout = useMemo(() => ({ band, free }), [band, free]);

  return (
    <div ref={rootRef} className="relative h-dvh w-full overflow-hidden" style={{ background: skyGradient }}>
      {show3d && (
        <div
          key={sceneKey}
          className="absolute inset-0"
          aria-hidden
          onPointerDown={(e) => {
            down.current = { x: e.clientX, y: e.clientY };
            pacer.markActive();
          }}
          // A pointer over the island: hovering answers at full rate.
          onPointerMove={() => pacer.markActive(600)}
          onWheel={() => pacer.markActive(1200)}
          onPointerUpCapture={(e) => {
            const d = down.current;
            // Remember whether this was a click, for the background handler.
            if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) down.current = null;
          }}
        >
          <HubScene
            time={time}
            place={place}
            goal={goal}
            returnFrom={returnFrom}
            hovered={hovered}
            onHover={setHovered}
            onSelect={focus}
            onBackground={() => {
              if (down.current) onBackground();
            }}
            onArrive={onArrive}
            signs={signs}
            pinLabels={pinLabels}
            badges={badges}
            tier={tier}
            pinned={tierPinned}
            reducedMotion={reducedMotion}
            onReady={onReady}
            onContextLost={onContextLost}
            photo={photo}
            onPhotoProgress={setPhotoState}
            onPhotoExit={endPhoto}
            api={sceneApi}
            layout={layout}
          />
        </div>
      )}

      {mounted && (!webgl || lost) && (
        <HubFallback
          facts={facts}
          reason={lost ? "lost" : "unsupported"}
          onRetry={
            lost
              ? () => {
                  setLost(false);
                  setReady(false);
                  setSceneKey((k) => k + 1);
                }
              : undefined
          }
        />
      )}

      <HubTopBar profile={profile} alerts={alerts} greeting={greeting} />

      {sky && place && show3d && (
        // On a phone, looking at a building gives the sky's row to the view.
        <div
          ref={hudRef}
          className={cn(
            "pointer-events-none absolute left-3 top-[4.25rem] z-40 flex items-start gap-2 sm:left-4 sm:top-[5.25rem]",
            focused && "max-sm:hidden"
          )}
        >
          <SkyChip
            phase={sky.state.phase}
            times={sky.times}
            city={place.city}
            previewMinutes={previewMinutes}
            nowMinutes={nowMinutes}
            onPreview={setPreviewMinutes}
          />
          {canPhoto && !entering && <PhotoButton active={photo} onClick={() => setPhoto((on) => !on)} />}
        </div>
      )}

      <AnimatePresence>{photo && <PhotoPanel key="photo" state={photoState} onSave={savePhoto} onClose={endPhoto} />}</AnimatePresence>

      {show3d && (
        <>
          <HubCards facts={facts} resume={resume} onVisit={focus} hidden={goal.kind !== "overview" || photo} boxRef={cardsRef} />
          <FocusPanel
            id={photo ? null : focused}
            facts={facts}
            onEnter={() => focused && enter(focused)}
            onBack={backToIsland}
            onStep={step}
            entering={entering}
            onLayout={onPanelLayout}
          />
          {goal.kind === "overview" && ready && !photo && (
            <p className="pointer-events-none absolute inset-x-4 bottom-[8.25rem] z-20 text-center text-[0.75rem] text-white/80 [text-shadow:0_1px_8px_rgba(0,0,0,0.45)] [@media(max-height:500px)]:hidden">
              {coarse ? m.hub.hintTouch : m.hub.hint}
            </p>
          )}
        </>
      )}

      {/* Until the first frames are drawn: this moment's sky and the mark, never a blank screen. */}
      <AnimatePresence>
        {(!mounted || (show3d && !ready)) && (
          <motion.div
            key="loading"
            className="absolute inset-0 z-50 grid place-items-center"
            style={{ background: skyGradient }}
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex flex-col items-center gap-3 text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.35)]">
              <LayoutGrid className="h-6 w-6 animate-pulse" aria-hidden />
              <p className="text-sm font-medium">{m.hub.loading}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Through the door: the app's own background, so the page behind appears on it.
          If the page takes its time (a slow network), a quiet sign that it is coming. */}
      <div
        className="pointer-events-none absolute inset-0 z-[60] grid place-items-center bg-background transition-opacity duration-500"
        style={{ opacity: fading ? 1 : 0 }}
        aria-hidden
      >
        <span
          className="h-5 w-5 rounded-full border-2 border-muted border-t-accent transition-opacity duration-300 motion-safe:animate-spin"
          style={{ opacity: fading ? 1 : 0, transitionDelay: fading ? "900ms" : "0ms" }}
        />
      </div>

      <h1 className="sr-only">{m.hub.title}</h1>
    </div>
  );
}
