import { Navigate, Route, Routes } from 'react-router-dom'
import DemoStage from './pages/DemoStage'
import OfficerConsole from './pages/OfficerConsole'
import WalkerApp from './walker'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<OfficerConsole />} />
      <Route path="/walker/:walkerId" element={<WalkerApp />} />
      <Route path="/demo" element={<DemoStage />} />
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  )
}
