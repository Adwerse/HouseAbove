import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useLocation, useOutlet } from "react-router-dom";

import { probeApi } from "../lib/api";
import MapStage from "../map/MapStage";
import TopNav from "./TopNav";

/**
 * One map for the whole app. Views (officer, walker, demo) float over it and tell
 * it what to show, so switching view is a camera move, not a page load.
 */
export default function Shell() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const section = pathname.startsWith("/walker") ? "walker" : pathname.startsWith("/demo") ? "demo" : "officer";

  useEffect(() => {
    void probeApi();
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper">
      <MapStage />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-28 bg-gradient-to-b from-paper/70 to-transparent" />
      <TopNav />
      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          className="pointer-events-none absolute inset-0 z-30"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {outlet}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
