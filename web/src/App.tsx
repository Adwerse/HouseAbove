import { Navigate, Route, Routes } from "react-router-dom";

import Shell from "./app/Shell";
import { DEFAULT_MOCK_WALKER_ID } from "./mocks";
import DemoView from "./views/demo/DemoView";
import OfficerView from "./views/officer/OfficerView";
import WalkerView from "./views/walker/WalkerView";

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<OfficerView />} />
        <Route path="/walker/:walkerId" element={<WalkerView />} />
        <Route path="/walker" element={<Navigate replace to={`/walker/${import.meta.env.VITE_DEMO_WALKER || DEFAULT_MOCK_WALKER_ID}`} />} />
        <Route path="/demo" element={<DemoView />} />
      </Route>
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
