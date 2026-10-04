import { Camera, Flame, Footprints, House, Lightbulb, MessageCircle, Repeat, Route, Store, type LucideIcon } from 'lucide-react'
import type { BadgeId } from '../lib/types'

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'civic'

export const TIER_COLORS: Record<BadgeTier, string> = {
  bronze: '#C8875A',
  silver: '#C7D0DD',
  gold: '#FFD166',
  civic: '#8B5CF6',
}

/** Mirrors backend/app/gamification/engine.py CATALOG (tier, icon) plus the walker-facing unlock line. */
export const BADGE_META: Record<BadgeId, { title: string; tier: BadgeTier; icon: LucideIcon; line: string }> = {
  first_look: { title: 'First Look', tier: 'bronze', icon: Camera, line: 'Your first facade is in. Every street starts with one photo.' },
  street_scout: { title: 'Street Scout', tier: 'silver', icon: Footprints, line: 'Ten facades captured. You are mapping the street for your town.' },
  main_street: { title: 'Main Street', tier: 'gold', icon: Store, line: 'Twenty facades on one street: full coverage, end to end.' },
  five_k: { title: '5K for Homes', tier: 'gold', icon: Route, line: 'Five kilometres walked while capturing. That is real ground covered.' },
  streak_3: { title: 'Three-Day Streak', tier: 'silver', icon: Flame, line: 'Captures on three different days. Steady walking adds up.' },
  local_knowledge: { title: 'Local Knowledge', tier: 'bronze', icon: MessageCircle, line: 'You logged what shop staff told you. Local answers matter most.' },
  second_look: { title: 'Second Look', tier: 'silver', icon: Repeat, line: 'You re-captured a facade another walker photographed first.' },
  homes_above: { title: 'Homes Above', tier: 'civic', icon: House, line: 'A facade you photographed was confirmed by the council as a candidate for homes.' },
  lights_on: { title: 'Lights On', tier: 'civic', icon: Lightbulb, line: 'A building you photographed is back in use as homes.' },
}

export function badgeMeta(id: string) {
  return BADGE_META[id as BadgeId] ?? { title: id.replaceAll('_', ' '), tier: 'bronze' as const, icon: Camera, line: '' }
}
