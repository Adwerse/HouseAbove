import { useId } from 'react'
import { TIER_COLORS, badgeMeta } from './badges'

/** Circular medal: tier-coloured ring around the badge's lucide icon. */
export function Medal({ badgeId, size = 96, muted = false }: { badgeId: string; size?: number; muted?: boolean }) {
  const meta = badgeMeta(badgeId)
  const ring = TIER_COLORS[meta.tier]
  const Icon = meta.icon
  const gradientId = useId()
  const stroke = Math.max(3, size / 16)

  return (
    <div className="relative shrink-0" style={{ width: size, height: size, opacity: muted ? 0.35 : 1 }} aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <radialGradient id={gradientId} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#26305A" />
            <stop offset="100%" stopColor="#10162E" />
          </radialGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={size / 2 - stroke / 2} fill={`url(#${gradientId})`} stroke={ring} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={size / 2 - stroke * 1.9} fill="none" stroke={ring} strokeOpacity={0.35} strokeWidth={1} />
      </svg>
      <Icon className="absolute inset-0 m-auto" size={size * 0.42} color={ring} strokeWidth={1.75} />
    </div>
  )
}
