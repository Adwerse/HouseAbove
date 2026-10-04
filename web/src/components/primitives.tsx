import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { STATUS_COLORS, STATUS_LABELS } from "../lib/status";
import type { DisplayStatus } from "../lib/types";
import { palette } from "../theme/tokens";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function StatusDot({ status, size = 8 }: { status: DisplayStatus; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: STATUS_COLORS[status] }} />;
}

export function StatusChip({ status, size = "sm" }: { status: DisplayStatus; size?: "sm" | "md" }) {
  const dark = status === "confirmed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
      )}
      style={{
        background: dark ? STATUS_COLORS[status] : `${STATUS_COLORS[status]}26`,
        color: dark ? "#fff" : status === "unclear" || status === "likely_used" ? palette.ink3 : shade(status),
      }}
    >
      <StatusDot status={status} size={size === "sm" ? 6 : 7} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function shade(status: DisplayStatus) {
  return { likely_underused: "#0A7D47", review: "#9A5B00", home: "#7A5A00" }[status as string] ?? palette.ink;
}

/** Fitness-style progress ring. */
export function Ring({
  value,
  size = 44,
  stroke = 5,
  color = palette.green,
  track = "rgba(11,16,13,0.08)",
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - clamped) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      {children ? <span className="absolute inset-0 grid place-items-center">{children}</span> : null}
    </span>
  );
}

/** A number that counts up to its value. */
export function CountUp({ value, decimals = 0, duration = 1.1 }: { value: number; decimals?: number; duration?: number }) {
  const mv = useMotionValue(0);
  const text = useTransform(mv, (v) => v.toFixed(decimals));
  const [, force] = useState(0);
  useEffect(() => {
    const controls = animate(mv, value, { duration, ease: [0.22, 1, 0.36, 1], onUpdate: () => force((n) => n + 1) });
    return () => controls.stop();
  }, [mv, value, duration]);
  return <motion.span className="numeral">{text}</motion.span>;
}

export function Thumb({ src, alt, className, label }: { src: string | null; alt: string; className?: string; label?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={cn("relative block overflow-hidden bg-mint", className)}>
      {src && !failed ? (
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="grid h-full w-full place-items-center text-[10px] font-semibold text-green-700">No photo</span>
      )}
      {label ? (
        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-white/85 px-1.5 py-0.5 text-[9px] font-semibold text-muted backdrop-blur">
          {label}
        </span>
      ) : null}
    </span>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[10px] bg-ink" style={{ width: size, height: size }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none">
        <path d="M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
        <rect x="9" y="9.5" width="6" height="4.5" rx="1" fill={palette.volt} />
        <path d="M7 21v-4h10v4" stroke="#fff" strokeWidth="2" />
      </svg>
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-md border border-black/10 bg-white px-1 font-mono text-[10px] font-semibold text-muted shadow-[0_1px_0_rgba(11,16,13,0.08)]">
      {children}
    </kbd>
  );
}

/** Model id to a readable model family, e.g. "deepseek/deepseek-v4.1-flash" -> "DeepSeek". */
export function modelFamily(model: string | null | undefined) {
  const id = (model ?? "").toLowerCase();
  if (id.includes("deepseek")) return "DeepSeek";
  if (id.includes("glm") || id.includes("z-ai")) return "GLM · Zhipu";
  if (id.includes("qwen")) return "Qwen";
  if (id.includes("kimi") || id.includes("moonshot")) return "Kimi";
  if (id.includes("minimax")) return "MiniMax";
  if (id.includes("gpt")) return "OpenAI";
  return model ? model.split("/").pop() ?? model : "Model";
}

export const SERVICE_LABELS = {
  bus: "Bus stop",
  grocery: "Grocery",
  school: "School",
  gp_or_pharmacy: "GP or pharmacy",
  park: "Park",
} as const;

export const SERVICE_LIMITS = { bus: 400, grocery: 400, school: 800, gp_or_pharmacy: 800, park: 800 } as const;
