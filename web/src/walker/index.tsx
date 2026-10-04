import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Award as AwardIcon, Footprints, Sun } from 'lucide-react'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { BADGE_IDS, type Award, type WalkerProfileResponse } from '../lib/types'
import { DEFAULT_MOCK_WALKER_ID, mockWalkerProfile } from '../mocks'
import { Card, Skeleton, Stat } from '../ui'
import { Medal } from './Medal'
import { UnlockMoment } from './UnlockMoment'
import { WalkReplay } from './WalkReplay'
import { badgeMeta } from './badges'

/** /walker/:walkerId, or VITE_DEMO_WALKER inside the /demo phone frame (no route param there). */
function useWalkerId() {
  const { walkerId } = useParams()
  return walkerId || import.meta.env.VITE_DEMO_WALKER || DEFAULT_MOCK_WALKER_ID
}

/** One tile per earned badge, in catalog order; homes_above / lights_on can be earned per building. */
function earnedBadges(awards: Award[]) {
  const counts = new Map<string, number>()
  for (const a of awards) counts.set(a.badge_id, (counts.get(a.badge_id) ?? 0) + 1)
  return BADGE_IDS.filter((id) => counts.has(id)).map((id) => ({ id, count: counts.get(id)! }))
}

function WalkerHome({ profile, sample }: { profile: WalkerProfileResponse; sample: boolean }) {
  const firstName = profile.walker.name.split(' ')[0] || profile.walker.name
  const { stats } = profile
  const earned = earnedBadges(profile.awards)

  return (
    <div className="h-full overflow-y-auto px-4 pb-8 pt-6">
      <p className="text-dusk-sm text-dusk-muted">{profile.walker.town}</p>
      <h1 className="mt-1 text-dusk-xl font-semibold tracking-[-0.01em]">Hi, {firstName}</h1>
      {sample ? (
        <p className="mt-2 text-dusk-xs text-dusk-warm">Showing sample data: could not load this walker.</p>
      ) : null}

      <Card className="mt-5" padding="md">
        <div className="grid grid-cols-3 gap-3">
          <Stat compact label="km walked" value={(stats.distance_m / 1000).toFixed(1)} />
          <Stat compact label="facades" value={stats.facades} />
          <Stat compact label="minutes" value={stats.minutes} />
        </div>
      </Card>

      <div className="mt-7 flex items-baseline justify-between">
        <h2 className="text-dusk-base font-semibold">Badges</h2>
        <span className="text-dusk-xs text-dusk-muted">{earned.length} of {BADGE_IDS.length}</span>
      </div>
      {earned.length ? (
        <ul className="mt-3 grid grid-cols-3 gap-x-3 gap-y-5">
          {earned.map(({ id, count }) => (
            <li key={id} className="flex flex-col items-center text-center">
              <div className="relative">
                <Medal badgeId={id} size={72} />
                {count > 1 ? (
                  <span className="absolute -right-1 -top-1 rounded-full bg-dusk-elevated px-1.5 text-dusk-xs font-semibold text-dusk-text">×{count}</span>
                ) : null}
              </div>
              <span className="mt-2 text-dusk-xs font-medium leading-4">{badgeMeta(id).title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-dusk-sm text-dusk-muted">Capture your first facade to earn First Look.</p>
      )}
    </div>
  )
}

function AllBadges({ profile }: { profile: WalkerProfileResponse }) {
  const earned = new Set(profile.awards.map((a) => a.badge_id))
  const progress = new Map(profile.progress.map((p) => [p.badge_id, p]))
  return (
    <div className="h-full overflow-y-auto px-4 pb-6 pt-6">
      <h1 className="text-dusk-xl font-semibold tracking-[-0.01em]">Badges</h1>
      <p className="mt-1 text-dusk-sm text-dusk-muted">Earned by walking and covering streets.</p>
      <ul className="mt-5 space-y-3">
        {BADGE_IDS.map((id) => {
          const p = progress.get(id)
          return (
            <li key={id} className="flex items-center gap-3">
              <Medal badgeId={id} size={52} muted={!earned.has(id)} />
              <div className="min-w-0">
                <p className="text-dusk-sm font-semibold">{badgeMeta(id).title}</p>
                <p className="text-dusk-xs text-dusk-muted">
                  {earned.has(id) ? 'Earned' : p ? `${p.badge_id === 'five_k' ? `${(p.current / 1000).toFixed(1)} / 5 km` : `${p.current} / ${p.target}`}` : 'Not yet'}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function LoadingHome() {
  return (
    <div className="space-y-4 px-4 pt-6">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

const TABS = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'walk', label: 'Walk', icon: Footprints },
  { id: 'badges', label: 'Badges', icon: AwardIcon },
] as const
type TabId = (typeof TABS)[number]['id']

export default function WalkerApp() {
  const walkerId = useWalkerId()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabId>('today')
  const profile = useQuery({ queryKey: ['walker', walkerId], queryFn: () => api.getWalker(walkerId) })
  const data = profile.data ?? mockWalkerProfile

  return (
    <main className="relative mx-auto flex h-dvh w-full max-w-[390px] flex-col overflow-hidden bg-dusk-background text-dusk-text">
      <div className="min-h-0 flex-1">
        {tab === 'walk' ? (
          <WalkReplay walkerId={walkerId} />
        ) : profile.isPending ? (
          <LoadingHome />
        ) : tab === 'badges' ? (
          <AllBadges profile={data} />
        ) : (
          <WalkerHome profile={data} sample={!profile.data} />
        )}
      </div>
      <nav className="z-20 grid shrink-0 grid-cols-3 border-t border-white/[0.07] bg-dusk-background" aria-label="Walker sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined}
            className={`flex flex-col items-center gap-0.5 py-2.5 text-dusk-xs font-medium ${tab === id ? 'text-dusk-warm' : 'text-dusk-muted'}`}>
            <Icon size={20} aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
      <UnlockMoment walkerId={walkerId} onAward={() => queryClient.invalidateQueries({ queryKey: ['walker', walkerId] })} />
    </main>
  )
}
