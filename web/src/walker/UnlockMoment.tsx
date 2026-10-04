import confetti from 'canvas-confetti'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEventStream } from '../lib/sse'
import type { BadgeId } from '../lib/types'
import { Button } from '../ui'
import { usePrefersReducedMotion } from '../ui/utils'
import { Medal } from './Medal'
import { TIER_COLORS, badgeMeta } from './badges'

interface Unlock {
  uid: number
  badgeId: BadgeId
  title: string
}

/**
 * Full-screen (within the walker frame) celebration for badge.awarded events of
 * this walker. Awards that arrive together are shown one after another.
 * Press "b" to fake a homes_above award while testing.
 */
export function UnlockMoment({ walkerId, onAward }: { walkerId: string; onAward?: () => void }) {
  const [queue, setQueue] = useState<Unlock[]>([])
  const current = queue[0]
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reducedMotion = usePrefersReducedMotion()

  const nextUid = useRef(0)
  const push = useCallback((badgeId: BadgeId, title: string) => {
    const uid = ++nextUid.current
    setQueue((q) => [...q, { uid, badgeId, title }])
  }, [])

  useEventStream((event) => {
    if (event.type !== 'badge.awarded' || event.data.walker_id !== walkerId) return
    push(event.data.badge_id, event.data.title || badgeMeta(event.data.badge_id).title)
    onAward?.()
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
      if (e.key.toLowerCase() === 'b' && !e.metaKey && !e.ctrlKey && !e.altKey) push('homes_above', 'Homes Above')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [push])

  useEffect(() => {
    if (!current || reducedMotion || !canvasRef.current) return
    const fire = confetti.create(canvasRef.current, { resize: true, useWorker: false })
    const colors = [TIER_COLORS[badgeMeta(current.badgeId).tier], '#FFD166', '#7C9CFF', '#E7EAF3']
    const timer = window.setTimeout(() => {
      fire({ particleCount: 90, spread: 75, startVelocity: 38, origin: { y: 0.42 }, colors, disableForReducedMotion: true })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      fire.reset()
    }
  }, [current, reducedMotion])

  const dismiss = () => setQueue((q) => q.slice(1))
  const meta = current ? badgeMeta(current.badgeId) : null

  return (
    <AnimatePresence>
      {current && meta ? (
        <motion.div
          key={current.uid}
          className="absolute inset-0 z-[60] flex flex-col items-center justify-center px-8 text-center"
          style={{ backgroundColor: 'rgba(3, 7, 18, 0.82)', backdropFilter: 'blur(6px)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          role="dialog"
          aria-modal="true"
          aria-label={`Badge unlocked: ${current.title}`}
        >
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
          <p className="text-dusk-xs font-semibold uppercase tracking-[0.14em] text-dusk-muted">Badge unlocked</p>
          <motion.div
            className="mt-6 rounded-full"
            initial={reducedMotion ? false : { scale: 0.2, rotate: -25, opacity: 0 }}
            animate={{
              scale: 1, rotate: 0, opacity: 1,
              boxShadow: [`0 0 0px ${TIER_COLORS[meta.tier]}00`, `0 0 48px ${TIER_COLORS[meta.tier]}AA`, `0 0 28px ${TIER_COLORS[meta.tier]}66`],
            }}
            transition={{ type: 'spring', stiffness: 260, damping: 16, boxShadow: { duration: 1.2, times: [0, 0.5, 1] } }}
          >
            <Medal badgeId={current.badgeId} size={96} />
          </motion.div>
          <motion.h2
            className="mt-6 text-dusk-xl font-semibold tracking-[-0.01em] text-dusk-text"
            initial={reducedMotion ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.25, duration: 0.3 }}
          >
            {current.title}
          </motion.h2>
          <motion.p
            className="mt-2 max-w-[18rem] text-dusk-sm leading-5 text-dusk-muted"
            initial={reducedMotion ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.3 }}
          >
            {meta.line}
          </motion.p>
          <Button className="mt-8 min-w-36" variant="warm" size="lg" onClick={dismiss} autoFocus>
            Nice
          </Button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
