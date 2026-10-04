import { useParams } from 'react-router-dom'
import { DEFAULT_MOCK_WALKER_ID } from '../mocks'
import { UnlockMoment } from './UnlockMoment'

/** /walker/:walkerId, or VITE_DEMO_WALKER inside the /demo phone frame (no route param there). */
function useWalkerId() {
  const { walkerId } = useParams()
  return walkerId || import.meta.env.VITE_DEMO_WALKER || DEFAULT_MOCK_WALKER_ID
}

export default function WalkerApp() {
  const walkerId = useWalkerId()

  return (
    <main className="relative mx-auto h-dvh w-full max-w-[390px] overflow-hidden bg-dusk-background text-dusk-text">
      <div className="grid h-full place-items-center p-6 text-center">
        <p className="text-dusk-sm text-dusk-muted">HomesAbove walker · {walkerId}</p>
      </div>
      <UnlockMoment walkerId={walkerId} />
    </main>
  )
}
