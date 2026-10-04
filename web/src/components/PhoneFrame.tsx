import type { ReactNode } from "react";

/**
 * A device frame for the walker app (B's WalkerApp). The app sizes itself to the
 * viewport (h-dvh); inside the frame it fills the screen instead.
 */
export default function PhoneFrame({ children, scale = 1 }: { children: ReactNode; scale?: number }) {
  return (
    <div className="pointer-events-auto origin-bottom-right" style={{ transform: `scale(${scale})` }}>
      <div className="relative h-[760px] w-[372px] rounded-[54px] bg-ink p-[11px] shadow-[0_40px_80px_-20px_rgba(11,16,13,0.55),0_0_0_1.5px_rgba(255,255,255,0.08)_inset]">
        <div className="absolute left-1/2 top-[19px] z-30 h-[26px] w-[104px] -translate-x-1/2 rounded-full bg-black" />
        <div className="relative h-full w-full overflow-hidden rounded-[44px] bg-ink pt-9 [&>main]:!h-full [&>main]:!max-w-none">
          <div className="absolute inset-x-0 top-0 z-20 flex h-9 items-end justify-between px-8 pb-1 text-[12px] font-semibold text-white">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-4 rounded-[3px] border border-white/80" />
            </span>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
