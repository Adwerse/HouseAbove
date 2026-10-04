import { useQuery } from "@tanstack/react-query";
import { Camera, Clock, Footprints, Pause, Play, RotateCcw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import PhoneFrame from "../../components/PhoneFrame";
import { cn, Ring } from "../../components/primitives";
import { api } from "../../lib/api";
import type { Walk } from "../../lib/types";
import { fitPoints, setPadding } from "../../map/controller";
import type { LngLat } from "../../map/geometry";
import { scene } from "../../map/scene";
import { DEFAULT_MOCK_WALKER_ID } from "../../mocks";
import WalkerApp from "../../walker";
import { palette } from "../../theme/tokens";
import { useReplay } from "../useReplay";

const dayFmt = new Intl.DateTimeFormat("en-IE", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Dublin" });
const timeFmt = new Intl.DateTimeFormat("en-IE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Dublin" });

function minutes(walk: Walk) {
  return Math.max(1, Math.round((Date.parse(walk.ended_at) - Date.parse(walk.started_at)) / 60000));
}

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** The walker's own view: their walks and photos on the map, and their app on the phone. Never AI statuses. */
export default function WalkerView() {
  const { walkerId = DEFAULT_MOCK_WALKER_ID } = useParams();
  const walksQuery = useQuery({ queryKey: ["walks", walkerId], queryFn: () => api.getWalkerWalks(walkerId) });
  const walks = useMemo(() => [...(walksQuery.data ?? [])].sort((a, b) => a.started_at.localeCompare(b.started_at)), [walksQuery.data]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const focus = walks.find((w) => w.id === focusId);
  const replay = useReplay(focus, { speed: 16 });
  const [phoneScale, setPhoneScale] = useState(1);

  useEffect(() => {
    const fit = () => setPhoneScale(Math.min(1, (window.innerHeight - 108) / 760));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // The walker map: trails and photo pins only.
  useEffect(() => {
    scene.set({ buildings: [], colorMode: "none", walks, focusWalkId: focusId, photoPins: true, replay: null, services: null, selectedId: null, revealed: null, visibleIds: null, onSelect: null });
  }, [walks, focusId]);
  useEffect(() => () => scene.set({ walks: [], photoPins: false, replay: null, focusWalkId: null }), []);

  useEffect(() => {
    setPadding({ left: 40 + 372 * phoneScale + 24, right: 380, top: 90, bottom: 40 }, false);
    const points = (focus ? [focus] : walks).flatMap((w) => w.path.coordinates as LngLat[]);
    if (points.length) fitPoints(points, { pitch: 56, bearing: focus ? 28 : 16 });
  }, [walks, focus, phoneScale]);

  const totalKm = walks.reduce((s, w) => s + w.distance_m, 0) / 1000;
  const totalFacades = walks.reduce((s, w) => s + w.captures.length, 0);

  return (
    <>
      <motion.div
        initial={{ x: -60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: -60, opacity: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 28 }}
        className="absolute bottom-6 left-10"
        style={{ width: 372 * phoneScale, height: 760 * phoneScale }}
      >
        <div className="absolute bottom-0 left-0 origin-bottom-left" style={{ transform: `scale(${phoneScale})` }}>
          <PhoneFrame>
            <WalkerApp />
          </PhoneFrame>
        </div>
      </motion.div>

      <motion.aside
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 60, opacity: 0 }}
        transition={{ type: "spring", stiffness: 240, damping: 30 }}
        className="glass-ink pointer-events-auto absolute right-4 top-[76px] flex max-h-[calc(100%-92px)] w-[352px] flex-col overflow-hidden rounded-panel"
        aria-label="Walks"
      >
        <div className="px-5 pb-4 pt-5">
          <p className="eyebrow text-volt">Your walks</p>
          <div className="mt-2 flex items-end gap-5">
            <div>
              <p className="text-[34px] font-bold leading-9 tracking-[-0.04em]">{totalKm.toFixed(1)}<span className="ml-1 text-[15px] font-semibold text-white/50">km</span></p>
              <p className="text-[11px] font-semibold text-white/50">walked</p>
            </div>
            <div>
              <p className="text-[34px] font-bold leading-9 tracking-[-0.04em]">{totalFacades}</p>
              <p className="text-[11px] font-semibold text-white/50">facades</p>
            </div>
            <div>
              <p className="text-[34px] font-bold leading-9 tracking-[-0.04em]">{walks.length}</p>
              <p className="text-[11px] font-semibold text-white/50">walks</p>
            </div>
          </div>
        </div>

        <ul className="scroll-thin-dark min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {walksQuery.isPending ? Array.from({ length: 3 }, (_, i) => <li key={i} className="h-20 animate-pulse rounded-2xl bg-white/5" />) : null}
          {walks.map((w) => {
            const active = w.id === focusId;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setFocusId(active ? null : w.id)}
                  className={cn("w-full rounded-2xl p-3 text-left transition-colors", active ? "bg-white/[0.09] ring-1 ring-volt/50" : "bg-white/[0.04] hover:bg-white/[0.07]")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold">{dayFmt.format(new Date(w.started_at))} · {timeFmt.format(new Date(w.started_at))}</span>
                    <span className="flex items-center gap-1 text-[11px] text-white/50"><Camera size={12} /> {w.captures.length}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-4 text-[12px] text-white/70">
                    <span className="flex items-center gap-1"><Footprints size={13} className="text-volt" /> {(w.distance_m / 1000).toFixed(2)} km</span>
                    <span className="flex items-center gap-1"><Clock size={13} className="text-teal" /> {minutes(w)} min</span>
                  </div>
                  <div className="mt-2 flex gap-1 overflow-hidden">
                    {w.captures.slice(0, 8).map((c) => (
                      <span key={c.building_id} className="size-7 shrink-0 rounded-lg bg-white/10 bg-cover bg-center" style={{ backgroundImage: c.thumb ? `url("${c.thumb}")` : undefined }} />
                    ))}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <AnimatePresence>
          {focus ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-white/10 px-5 py-4"
            >
              <div className="flex items-center gap-4">
                <Ring value={replay.stats.progress} size={56} stroke={5} color={palette.volt} track="rgba(255,255,255,0.1)">
                  <button
                    type="button"
                    onClick={() => (replay.playing ? replay.stop() : replay.play())}
                    aria-label={replay.playing ? "Pause replay" : "Replay walk"}
                    className="grid size-10 place-items-center rounded-full bg-volt text-ink transition hover:scale-105"
                  >
                    {replay.playing ? <Pause size={17} fill="currentColor" /> : replay.stats.progress >= 1 ? <RotateCcw size={17} /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
                  </button>
                </Ring>
                <div className="grid flex-1 grid-cols-3 gap-2">
                  <div><p className="text-[18px] font-bold tabular-nums">{(replay.stats.metres / 1000).toFixed(2)}</p><p className="text-[10.5px] text-white/50">km</p></div>
                  <div><p className="text-[18px] font-bold tabular-nums">{replay.stats.facades}</p><p className="text-[10.5px] text-white/50">facades</p></div>
                  <div><p className="text-[18px] font-bold tabular-nums">{clock(replay.stats.seconds)}</p><p className="text-[10.5px] text-white/50">time</p></div>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-white/40">Replay at 16× · the map follows the walk</p>
            </motion.div>
          ) : (
            <p className="border-t border-white/10 px-5 py-3 text-[11.5px] text-white/50">Pick a walk to replay it on the map.</p>
          )}
        </AnimatePresence>
      </motion.aside>
    </>
  );
}
