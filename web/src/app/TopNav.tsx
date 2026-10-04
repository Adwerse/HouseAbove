import { Footprints, Play, ScanSearch } from "lucide-react";
import { motion } from "motion/react";
import { NavLink, useLocation } from "react-router-dom";

import { cn, Logo } from "../components/primitives";
import { useDataSource } from "../lib/data-mode";
import { DEFAULT_MOCK_WALKER_ID } from "../mocks";

const walkerId = import.meta.env.VITE_DEMO_WALKER || DEFAULT_MOCK_WALKER_ID;

const MODES = [
  { to: "/", label: "Officer", icon: ScanSearch, match: (p: string) => p === "/" },
  { to: `/walker/${walkerId}`, label: "Walker", icon: Footprints, match: (p: string) => p.startsWith("/walker") },
  { to: "/demo", label: "Demo", icon: Play, match: (p: string) => p.startsWith("/demo") },
];

function DataBadge() {
  const source = useDataSource((s) => s.source);
  const copy = {
    live: { label: "Live", dot: "bg-green", title: "Data from the HomesAbove API" },
    static: { label: "Static export", dot: "bg-teal", title: "Exported data, no backend" },
    demo: { label: "Demo data", dot: "bg-amber", title: "The API is not reachable: showing the bundled demo dataset (real OpenStreetMap geometry, invented walks and readings)." },
  }[source];
  return (
    <span title={copy.title} className="glass inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-xs font-semibold text-ink">
      <span className="relative flex size-2">
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", copy.dot)} />
        <span className={cn("relative inline-flex size-2 rounded-full", copy.dot)} />
      </span>
      {copy.label}
    </span>
  );
}

export default function TopNav() {
  const { pathname } = useLocation();
  return (
    <header className="pointer-events-none absolute inset-x-4 top-4 z-40 flex items-center justify-between gap-3">
      <NavLink to="/" className="glass pointer-events-auto inline-flex h-11 items-center gap-2.5 rounded-full py-1 pl-1.5 pr-4">
        <Logo size={32} />
        <span className="text-[15px] font-bold tracking-[-0.02em] text-ink">HomesAbove</span>
      </NavLink>

      <nav className="glass pointer-events-auto relative flex h-11 items-center rounded-full p-1" aria-label="Views">
        {MODES.map(({ to, label, icon: Icon, match }) => {
          const active = match(pathname);
          return (
            <NavLink
              key={label}
              to={to}
              className={cn(
                "relative z-10 inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors duration-200",
                active ? "text-white" : "text-muted hover:text-ink",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 -z-10 rounded-full bg-ink"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <Icon size={15} strokeWidth={2.4} />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <div className="pointer-events-auto flex items-center gap-2">
        <DataBadge />
      </div>
    </header>
  );
}
