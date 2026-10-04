import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bus, Check, ChevronLeft, ChevronRight, CircleAlert, Database, GraduationCap, House, LoaderCircle, Pause, Play, ShoppingBasket, Stethoscope, TreePine, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import PhoneFrame from "../../components/PhoneFrame";
import { cn, CountUp, Kbd, modelFamily, SERVICE_LABELS, StatusChip } from "../../components/primitives";
import { api } from "../../lib/api";
import { STATUS_COLORS } from "../../lib/status";
import type { Building, ServiceKind, UpperStatus, Walk } from "../../lib/types";
import { flyTo, flyToBuilding, setPadding, startOrbit, stopOrbit } from "../../map/controller";
import { scene } from "../../map/scene";
import { DEFAULT_MOCK_WALKER_ID, DEMO_QUESTIONS, TALBOT_STREET } from "../../mocks";
import WalkerApp from "../../walker";
import { serviceColors } from "../../theme/tokens";
import { byRank, streetCamera } from "../streets";
import { useAgent } from "../useAgent";
import { useReplay } from "../useReplay";

const WALKER = import.meta.env.VITE_DEMO_WALKER || DEFAULT_MOCK_WALKER_ID;
const REPLAY_SPEED = 26;

type StepKey = "hook" | "walk" | "read" | "human" | "services" | "agent" | "loop";
const STEPS: { key: StepKey; eyebrow: string; title: string; body: string; ms: number }[] = [
  { key: "hook", eyebrow: "The opportunity", title: "Look above any shop", body: "On an Irish main street the windows upstairs are often dark. Those floors could be homes, and nobody has a list of them.", ms: 7000 },
  { key: "walk", eyebrow: "Fitness with a civic payoff", title: "A morning walk becomes evidence", body: "Rodion walked Talbot Street on Sunday morning. Every facade he photographed from the opposite pavement is a data point for the council.", ms: 0 },
  { key: "read", eyebrow: "Two independent AI passes", title: "Every facade, read twice", body: "One model reads the whole facade. A second model family sees only the upper floors and answers a different question. EU-hosted inference.", ms: 7500 },
  { key: "human", eyebrow: "Escalation, not proof", title: "When they disagree, a human decides", body: "Disagreement or low confidence sends the building to a person. Two passes agreeing is still not ground truth.", ms: 8000 },
  { key: "services", eyebrow: "Services within walking distance", title: "Bus, grocery, GP: already there", body: "OpenStreetMap shows the everyday services each candidate already has nearby, scored out of five.", ms: 8000 },
  { key: "agent", eyebrow: "An agent over MCP", title: "Ask in plain English", body: "A council officer asks where to look first. The agent calls read-only tools over MongoDB and cites the evidence. It only recommends.", ms: 0 },
  { key: "loop", eyebrow: "The loop closes", title: "The council confirms. The walker hears about it.", body: "The officer logs a confirmed candidate, and the walker who photographed it unlocks Homes Above.", ms: 9000 },
];

const SERVICE_ICONS: Record<ServiceKind, LucideIcon> = { bus: Bus, grocery: ShoppingBasket, school: GraduationCap, gp_or_pharmacy: Stethoscope, park: TreePine };

function Card({ children }: { children: ReactNode }) {
  return <div className="mt-4 rounded-2xl bg-surface-alt p-3">{children}</div>;
}

export default function DemoView() {
  const queryClient = useQueryClient();
  const buildingsQuery = useQuery({ queryKey: ["buildings"], queryFn: () => api.getBuildings() });
  const walksQuery = useQuery({ queryKey: ["walks", WALKER], queryFn: () => api.getWalkerWalks(WALKER) });
  const all = useMemo<Building[]>(() => buildingsQuery.data?.features.map((f) => f.properties) ?? [], [buildingsQuery.data]);
  // the story street: Talbot Street in the demo data, else the street with the most facades
  const storyStreet = useMemo(() => {
    if (all.some((b) => b.street === TALBOT_STREET)) return TALBOT_STREET;
    const counts = new Map<string, number>();
    for (const b of all) if (b.street) counts.set(b.street, (counts.get(b.street) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? TALBOT_STREET;
  }, [all]);
  const talbot = useMemo(() => all.filter((b) => b.street === storyStreet).sort(byRank), [all, storyStreet]);
  const top = talbot.find((b) => b.display_status === "likely_underused" || b.display_status === "confirmed") ?? talbot[0];
  const disagreement = talbot.find((b) => b.display_status === "review" && b.verifier && !b.verifier.agree) ?? all.find((b) => b.display_status === "review");
  // the walk with the most facades is the story's "Sunday morning" walk
  const walk: Walk | undefined = useMemo(
    () => [...(walksQuery.data ?? [])].sort((a, b) => b.captures.length - a.captures.length)[0],
    [walksQuery.data],
  );
  // step 3 reads every surveyed facade on the streets that walk covered (and the top candidate's)
  const storyIds = useMemo(() => {
    const ids = new Set(walk?.building_ids ?? []);
    const streets = new Set(all.filter((b) => ids.has(b.id)).map((b) => b.street));
    if (top?.street) streets.add(top.street);
    return new Set(all.filter((b) => streets.has(b.street)).map((b) => b.id));
  }, [walk, all, top]);
  const servicesQuery = useQuery({ queryKey: ["services", top?.id], queryFn: () => api.getBuildingServices(top!.id), enabled: Boolean(top) });

  const [step, setStep] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [revealed, setRevealed] = useState(0);
  const [loopDone, setLoopDone] = useState(false);
  const [phoneScale, setPhoneScale] = useState(1);
  const agent = useAgent();
  const ready = all.length > 0 && Boolean(walk);
  const current = STEPS[step];

  const replay = useReplay(current.key === "walk" ? walk : undefined, {
    speed: REPLAY_SPEED,
    onEnd: () => autoplayRef.current && window.setTimeout(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1600),
  });
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  useEffect(() => {
    const fit = () => setPhoneScale(Math.min(0.92, (window.innerHeight - 120) / 760));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  const go = useCallback((n: number) => setStep(Math.max(0, Math.min(STEPS.length - 1, n))), []);

  // ------------------------------------------------------------ each step drives the map
  useEffect(() => {
    if (!ready) return;
    setPadding({ left: 470, right: 372 * phoneScale + 56, top: 80, bottom: 110 }, false);
    stopOrbit();
    const base = { buildings: all, walks: [] as Walk[], replay: null, focusWalkId: null, photoPins: false, services: null, selectedId: null, revealed: null, visibleIds: null, hoverId: null };
    const street = streetCamera(storyStreet, all);
    switch (current.key) {
      case "hook":
        scene.set({ ...base, colorMode: "none" });
        flyTo({ ...street, zoom: 16.3, pitch: 66, bearing: (street.bearing + 330) % 360 }, 2600);
        window.setTimeout(() => startOrbit(2.2), 2700);
        break;
      case "walk":
        scene.set({ ...base, colorMode: "captured", walks: walk ? [walk] : [], focusWalkId: walk?.id ?? null, visibleIds: new Set() });
        window.setTimeout(() => replay.play(0), 900);
        break;
      case "read":
        setRevealed(0);
        scene.set({ ...base, colorMode: "status", walks: walk ? [walk] : [], visibleIds: storyIds, revealed: new Set() });
        flyTo({ ...street, zoom: 16.9, pitch: 60 }, 2000);
        break;
      case "human":
        if (disagreement) {
          scene.set({ ...base, colorMode: "status", selectedId: disagreement.id });
          flyToBuilding(disagreement, { zoom: 18.2, bearing: street.bearing });
        }
        break;
      case "services":
        if (top) {
          scene.set({ ...base, colorMode: "status", selectedId: top.id, services: servicesQuery.data ? { buildingId: top.id, pois: servicesQuery.data.pois } : null });
          flyToBuilding(top, { zoom: 16.4, pitch: 58, bearing: street.bearing, duration: 2200 });
        }
        break;
      case "agent":
        if (top) {
          scene.set({ ...base, colorMode: "status", selectedId: top.id });
          flyToBuilding(top, { zoom: 17.6, bearing: (street.bearing + 20) % 360 });
        }
        void agent.ask(DEMO_QUESTIONS[0], { replay: true });
        break;
      case "loop":
        if (top) {
          scene.set({ ...base, colorMode: "status", selectedId: top.id });
          flyToBuilding(top, { zoom: 18.4, pitch: 66, bearing: (street.bearing + 40) % 360 });
          setLoopDone(false);
          window.setTimeout(() => {
            void api.recordInspection(top.id, "confirmed_candidate", "Demo: confirmed on the site visit").then(() => {
              setLoopDone(true);
              void queryClient.invalidateQueries({ queryKey: ["buildings"] });
            });
          }, 2400);
          window.setTimeout(() => startOrbit(3), 4200);
        }
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, ready]);

  // keep buildings fresh (the loop step turns the top candidate "confirmed")
  useEffect(() => {
    if (ready && current.key !== "walk") scene.set({ buildings: all });
  }, [all, ready, current.key]);

  // walk: light up each house as its photo is taken
  useEffect(() => {
    if (current.key !== "walk" || !walk) return;
    const t0 = Date.parse(walk.started_at);
    scene.set({ visibleIds: new Set(walk.captures.filter((c) => (Date.parse(c.t) - t0) / 1000 <= replay.t).map((c) => c.building_id)) });
  }, [replay.t, walk, current.key]);

  // read: reveal statuses one by one, best rank first
  const order = useMemo(() => all.filter((b) => storyIds.has(b.id)).sort(byRank), [all, storyIds]);
  useEffect(() => {
    if (current.key !== "read") return;
    const timer = window.setInterval(() => setRevealed((n) => (n >= order.length ? n : n + 1)), 260);
    return () => window.clearInterval(timer);
  }, [current.key, order.length]);
  useEffect(() => {
    if (current.key === "read") scene.set({ revealed: new Set(order.slice(0, revealed).map((b) => b.id)) });
  }, [revealed, order, current.key]);

  // services arrive after the step starts
  useEffect(() => {
    if (current.key === "services" && top && servicesQuery.data) scene.set({ services: { buildingId: top.id, pois: servicesQuery.data.pois } });
  }, [current.key, top, servicesQuery.data]);

  // autoplay for the fixed-length steps (walk and agent advance when they finish)
  useEffect(() => {
    if (!autoplay || !current.ms || step >= STEPS.length - 1) return;
    const timer = window.setTimeout(() => go(step + 1), current.ms);
    return () => window.clearTimeout(timer);
  }, [autoplay, step, current.ms, go]);
  useEffect(() => {
    if (autoplay && current.key === "agent" && !agent.trace.streaming && agent.trace.answer) {
      const timer = window.setTimeout(() => go(step + 1), 3500);
      return () => window.clearTimeout(timer);
    }
  }, [autoplay, current.key, agent.trace.streaming, agent.trace.answer, step, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const n = Number(e.key);
      if (n >= 1 && n <= STEPS.length) go(n - 1);
      else if (e.key === "ArrowRight") go(step + 1);
      else if (e.key === "ArrowLeft") go(step - 1);
      else if (e.key === " ") {
        e.preventDefault();
        setAutoplay((a) => !a);
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, step]);

  useEffect(() => () => {
    stopOrbit();
    scene.set({ walks: [], replay: null, revealed: null, visibleIds: null, services: null, selectedId: null, focusWalkId: null });
  }, []);

  const revealedCounts = useMemo(() => {
    const shown = order.slice(0, revealed);
    const count = (s: string) => shown.filter((b) => b.display_status === s).length;
    return { read: shown.length, underused: count("likely_underused") + count("confirmed"), review: count("review") };
  }, [order, revealed]);

  return (
    <>
      {/* story */}
      <motion.section
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -40, opacity: 0 }}
        className="glass pointer-events-auto absolute left-4 top-[76px] w-[430px] overflow-hidden rounded-panel"
        aria-live="polite"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={current.key}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="px-6 pb-6 pt-5"
          >
            <p className="flex items-center gap-2">
              <span className="numeral text-[13px] font-bold text-green-700">{String(step + 1).padStart(2, "0")}</span>
              <span className="text-[13px] text-faint">/ {String(STEPS.length).padStart(2, "0")}</span>
              <span className="eyebrow ml-1 text-muted">{current.eyebrow}</span>
            </p>
            <h1 className="mt-2 text-[30px] font-bold leading-[34px] tracking-[-0.035em] text-ink">{current.title}</h1>
            <p className="mt-2.5 text-[14.5px] leading-[22px] text-muted">{current.body}</p>

            {current.key === "walk" ? (
              <Card>
                <div className="grid grid-cols-3 gap-2">
                  <div><p className="text-[24px] font-bold tabular-nums tracking-[-0.03em]">{(replay.stats.metres / 1000).toFixed(2)}</p><p className="text-[11px] font-semibold text-muted">km</p></div>
                  <div><p className="text-[24px] font-bold tabular-nums tracking-[-0.03em]">{replay.stats.facades}</p><p className="text-[11px] font-semibold text-muted">facades</p></div>
                  <div><p className="text-[24px] font-bold tabular-nums tracking-[-0.03em]">{Math.floor(replay.stats.seconds / 60)}:{String(Math.floor(replay.stats.seconds % 60)).padStart(2, "0")}</p><p className="text-[11px] font-semibold text-muted">minutes</p></div>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/5"><div className="h-full rounded-full bg-green" style={{ width: `${replay.stats.progress * 100}%` }} /></div>
              </Card>
            ) : null}

            {current.key === "read" ? (
              <Card>
                <div className="grid grid-cols-3 gap-2">
                  <div><p className="text-[24px] font-bold tracking-[-0.03em]"><CountUp value={revealedCounts.read} duration={0.3} /></p><p className="text-[11px] font-semibold text-muted">read by AI</p></div>
                  <div><p className="text-[24px] font-bold tracking-[-0.03em]" style={{ color: STATUS_COLORS.likely_underused }}><CountUp value={revealedCounts.underused} duration={0.3} /></p><p className="text-[11px] font-semibold text-muted">likely underused</p></div>
                  <div><p className="text-[24px] font-bold tracking-[-0.03em]" style={{ color: "#B26B00" }}><CountUp value={revealedCounts.review} duration={0.3} /></p><p className="text-[11px] font-semibold text-muted">sent to a human</p></div>
                </div>
              </Card>
            ) : null}

            {current.key === "human" && disagreement ? (
              <Card>
                <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[#8A5300]"><CircleAlert size={14} /> {disagreement.label}: the passes disagree</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Pass 1 · {modelFamily(disagreement.models.vision)}</p>
                    <div className="mt-1.5"><StatusChip status={(disagreement.upper_status ?? "unclear") as UpperStatus} /></div>
                    <p className="mt-1.5 text-[11.5px] leading-4 text-muted">{disagreement.upper_signals[0] ?? "no clear signals"}</p>
                  </div>
                  <div className="rounded-xl bg-white p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Pass 2 · {modelFamily(disagreement.verifier?.model)}</p>
                    <div className="mt-1.5"><StatusChip status={(disagreement.verifier?.status ?? "unclear") as UpperStatus} /></div>
                    <p className="mt-1.5 text-[11.5px] leading-4 text-muted">{disagreement.verifier?.for_use[0] ?? disagreement.verifier?.against_use[0] ?? "—"}</p>
                  </div>
                </div>
              </Card>
            ) : null}

            {current.key === "services" && servicesQuery.data ? (
              <Card>
                <ul className="space-y-1.5">
                  {servicesQuery.data.pois.map((p, i) => {
                    const Icon = SERVICE_ICONS[p.kind];
                    return (
                      <motion.li key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.09 }} className="flex items-center gap-2.5">
                        <span className="grid size-6 place-items-center rounded-full text-white" style={{ background: serviceColors[p.kind] }}><Icon size={13} /></span>
                        <span className="flex-1 truncate text-[12.5px] font-semibold">{SERVICE_LABELS[p.kind]} <span className="font-normal text-muted">· {p.name}</span></span>
                        <span className="text-[12.5px] font-semibold tabular-nums">{p.dist_m} m</span>
                      </motion.li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-[12px] font-semibold text-green-700">Services {servicesQuery.data.services?.score ?? 0}/5 within walking distance</p>
              </Card>
            ) : null}

            {current.key === "agent" ? (
              <Card>
                <p className="text-[12.5px] font-semibold text-ink">“{DEMO_QUESTIONS[0]}”</p>
                <ul className="mt-2 space-y-1">
                  {agent.trace.calls.map((c) => {
                    const r = agent.trace.results.find((x) => x.id === c.id);
                    return (
                      <li key={c.id} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5">
                        {r ? <Database size={12} className="text-green" /> : <LoaderCircle size={12} className="animate-spin text-muted" />}
                        <span className="font-mono text-[11.5px] font-semibold">{c.name}</span>
                        {r ? <span className="ml-auto font-mono text-[10.5px] text-muted">{r.db_op} · {r.ms} ms</span> : null}
                      </li>
                    );
                  })}
                </ul>
                {agent.trace.answer ? <p className="mt-2 line-clamp-6 whitespace-pre-line text-[12.5px] leading-[19px] text-ink-3">{agent.trace.answer}</p> : null}
              </Card>
            ) : null}

            {current.key === "loop" ? (
              <Card>
                <div className="flex items-center gap-3">
                  <span className={cn("grid size-10 place-items-center rounded-full transition-colors duration-500", loopDone ? "bg-forest text-volt" : "bg-black/5 text-muted")}>
                    {loopDone ? <Check size={20} strokeWidth={3} /> : <LoaderCircle size={18} className="animate-spin" />}
                  </span>
                  <div>
                    <p className="text-[13.5px] font-semibold">{loopDone ? "Inspection recorded: confirmed candidate" : "Officer logging the inspection…"}</p>
                    <p className="flex items-center gap-1 text-[12px] text-muted"><House size={12} /> {loopDone ? "Homes Above unlocked on the walker's phone" : top?.label}</p>
                  </div>
                </div>
              </Card>
            ) : null}
          </motion.div>
        </AnimatePresence>
      </motion.section>

      {/* phone */}
      <motion.div
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 60, opacity: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 28 }}
        className="absolute bottom-6 right-8"
        style={{ width: 372 * phoneScale, height: 760 * phoneScale }}
      >
        <div className="absolute bottom-0 right-0 origin-bottom-right" style={{ transform: `scale(${phoneScale})` }}>
          <PhoneFrame><WalkerApp /></PhoneFrame>
        </div>
      </motion.div>

      {/* step rail */}
      <motion.nav
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        className="glass pointer-events-auto absolute bottom-5 flex items-center gap-2 rounded-full p-1.5"
        style={{ left: 470, right: 372 * phoneScale + 56 + 24, maxWidth: 760 }}
        aria-label="Demo steps"
      >
        <button type="button" onClick={() => go(step - 1)} aria-label="Previous step" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-black/5 hover:text-ink"><ChevronLeft size={18} /></button>
        <button type="button" onClick={() => setAutoplay((a) => !a)} aria-label={autoplay ? "Pause" : "Autoplay"} className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-volt">
          {autoplay ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
        </button>
        <ol className="flex min-w-0 flex-1 gap-1">
          {STEPS.map((s, i) => (
            <li key={s.key} className="min-w-0 flex-1">
              <button type="button" onClick={() => go(i)} className="group block w-full py-2" title={`${i + 1}. ${s.title}`}>
                <span className="relative block h-1.5 overflow-hidden rounded-full bg-black/10">
                  <motion.span
                    className="absolute inset-y-0 left-0 rounded-full bg-green"
                    initial={false}
                    animate={{ width: i < step ? "100%" : i === step ? (s.key === "walk" ? `${replay.stats.progress * 100}%` : "100%") : "0%" }}
                    transition={{ duration: i === step && autoplay && s.ms ? s.ms / 1000 : 0.4, ease: i === step && autoplay ? "linear" : [0.22, 1, 0.36, 1] }}
                  />
                </span>
                <span className={cn("mt-1 block truncate text-left text-[10.5px] font-semibold", i === step ? "text-ink" : "text-faint group-hover:text-muted")}>{i + 1}. {s.title}</span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => go(step + 1)} aria-label="Next step" className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-black/5 hover:text-ink"><ChevronRight size={18} /></button>
        <span className="hidden shrink-0 items-center gap-1 pr-2 text-[10.5px] text-faint xl:flex"><Kbd>1</Kbd>–<Kbd>7</Kbd><Kbd>␣</Kbd></span>
      </motion.nav>

      {!ready ? (
        <div className="absolute inset-0 grid place-items-center">
          <p className="glass flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold"><LoaderCircle size={16} className="animate-spin" /> Loading the street…</p>
        </div>
      ) : null}
    </>
  );
}
