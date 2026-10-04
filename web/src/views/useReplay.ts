import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Walk } from "../lib/types";
import { follow } from "../map/controller";
import { distanceM, positionAt, walkSeconds, type LngLat } from "../map/geometry";
import { scene } from "../map/scene";

/** Replays a walk on the shared map: animated trail, walker dot, camera following, live counters. */
export function useReplay(walk: Walk | undefined, options: { speed?: number; followCamera?: boolean; onEnd?: () => void } = {}) {
  const { speed = 14, followCamera = true } = options;
  const onEnd = useRef(options.onEnd);
  onEnd.current = options.onEnd;
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = useRef(0);
  const lastFollow = useRef(0);

  const timeline = useMemo(() => {
    if (!walk) return null;
    const path = walk.path.coordinates as LngLat[];
    const secs = walkSeconds(walk.times as Array<string | number>);
    const cumulative = [0];
    for (let i = 1; i < path.length; i++) cumulative.push(cumulative[i - 1] + distanceM(path[i - 1], path[i]));
    const t0 = typeof walk.times[0] === "string" ? Date.parse(walk.times[0]) : 0;
    const captureTimes = walk.captures.map((c) => (Date.parse(c.t) - t0) / 1000).sort((a, b) => a - b);
    return { path, secs, cumulative, captureTimes, duration: secs[secs.length - 1] ?? 0 };
  }, [walk]);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setPlaying(false);
  }, []);

  const play = useCallback((from?: number) => {
    if (!walk || !timeline) return;
    cancelAnimationFrame(frame.current);
    let current = from ?? (t >= timeline.duration ? 0 : t);
    let last = performance.now();
    setPlaying(true);
    const step = (now: number) => {
      current = Math.min(timeline.duration, current + ((now - last) / 1000) * speed);
      last = now;
      setT(current);
      scene.set({ replay: { walkId: walk.id, t: current } });
      if (followCamera && now - lastFollow.current > 850) {
        lastFollow.current = now;
        const ahead = positionAt(timeline.path, timeline.secs, Math.min(timeline.duration, current + speed * 0.9));
        follow(ahead.point, ahead.heading);
      }
      if (current < timeline.duration) frame.current = requestAnimationFrame(step);
      else {
        setPlaying(false);
        onEnd.current?.();
      }
    };
    frame.current = requestAnimationFrame(step);
  }, [walk, timeline, t, speed, followCamera]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => {
    stop();
    setT(0);
  }, [walk?.id, stop]);

  const stats = useMemo(() => {
    if (!timeline) return { metres: 0, facades: 0, seconds: 0, progress: 0 };
    let i = timeline.secs.findIndex((s) => s > t);
    if (i < 0) i = timeline.secs.length - 1;
    const metres = timeline.cumulative[Math.max(0, i - 1)] ?? 0;
    return {
      metres,
      facades: timeline.captureTimes.filter((c) => c <= t).length,
      seconds: t,
      progress: timeline.duration ? t / timeline.duration : 0,
    };
  }, [timeline, t]);

  return { t, playing, play, stop, stats, duration: timeline?.duration ?? 0, seek: setT };
}
