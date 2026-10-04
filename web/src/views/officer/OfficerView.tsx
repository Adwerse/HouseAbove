import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import Toasts, { useToasts } from "../../components/Toasts";
import { api } from "../../lib/api";
import { useDataSource } from "../../lib/data-mode";
import { useEventStream } from "../../lib/sse";
import type { Building, InspectionOutcome, UpperStatus } from "../../lib/types";
import { flyTo, flyToBuilding, setPadding } from "../../map/controller";
import { scene } from "../../map/scene";
import { summaryFor, TALBOT_STREET } from "../../mocks";
import { useAgent } from "../useAgent";
import { byRank, frameStreet, streetCamera, streetsOf } from "../streets";
import AgentSheet from "./AgentSheet";
import BuildingPanel from "./BuildingPanel";
import CandidateList, { type Filter } from "./CandidateList";
import EvalModal from "./EvalModal";

const LEFT = 408;
const RIGHT_OPEN = 448;

export default function OfficerView() {
  const queryClient = useQueryClient();
  const source = useDataSource((s) => s.source);
  const { toasts, push } = useToasts();
  const agent = useAgent();

  const buildingsQuery = useQuery({ queryKey: ["buildings"], queryFn: () => api.getBuildings() });
  const all = useMemo<Building[]>(() => buildingsQuery.data?.features.map((f) => f.properties) ?? [], [buildingsQuery.data]);
  const streets = useMemo(() => streetsOf(all), [all]);

  const [chosenStreet, setChosenStreet] = useState<string | null>(null);
  const street = chosenStreet ?? streets.find((s) => s.name === TALBOT_STREET)?.name ?? streets[0]?.name ?? null;
  const onStreet = useMemo(() => all.filter((b) => b.street === street).sort(byRank), [all, street]);
  const summary = useMemo(() => summaryFor(onStreet), [onStreet]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [agentOpen, setAgentOpen] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const selected = selectedId ? all.find((b) => b.id === selectedId) ?? null : null;

  const services = useQuery({ queryKey: ["services", selectedId], queryFn: () => api.getBuildingServices(selectedId!), enabled: Boolean(selectedId) });
  const similar = useQuery({ queryKey: ["similar", selectedId], queryFn: () => api.getSimilarBuildings(selectedId!, 5), enabled: Boolean(selectedId) });
  const evalQuery = useQuery({ queryKey: ["eval"], queryFn: api.getEval, enabled: evalOpen });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["buildings"] });
    void queryClient.invalidateQueries({ queryKey: ["eval"] });
  }, [queryClient]);

  const labelMutation = useMutation({
    mutationFn: ({ id, label }: { id: string; label: UpperStatus }) => api.setHumanLabel(id, label),
    onSuccess: refresh,
    onError: (e) => push({ title: "Could not save the human screen", body: String(e), tone: "error" }),
  });
  const inspectionMutation = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: InspectionOutcome }) => api.recordInspection(id, outcome),
    onSuccess: refresh,
    onError: (e) => push({ title: "Could not record the inspection", body: String(e), tone: "error" }),
  });

  useEventStream((event) => {
    if (event.type === "building.updated") refresh();
    if (event.type === "inspection.recorded") push({ title: "Inspection recorded", body: `${event.data.id}: ${event.data.outcome.replaceAll("_", " ")}`, tone: "success" });
    if (event.type === "badge.awarded") push({ title: `Badge for ${event.data.walker_id.replace(/^w_/, "")}: ${event.data.title}`, body: "Their walk made this follow-up possible.", tone: "badge" });
  });

  // ---------------------------------------------------------------- the shared map
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    const b = id ? all.find((x) => x.id === id) : null;
    if (b) {
      if (b.street && b.street !== street) setChosenStreet(b.street);
      setPadding({ left: LEFT, right: RIGHT_OPEN, top: 80, bottom: 40 }, false);
      flyToBuilding(b);
    }
  }, [all, street]);

  useEffect(() => {
    scene.set({ buildings: all, colorMode: "status", walks: [], replay: null, focusWalkId: null, photoPins: false, revealed: null, visibleIds: null });
  }, [all]);
  useEffect(() => {
    scene.set({ onSelect: (id) => select(id) });
  }, [select]);
  useEffect(() => () => scene.set({ onSelect: null, selectedId: null, services: null, hoverId: null }), []);
  useEffect(() => {
    scene.set({ selectedId });
  }, [selectedId]);
  useEffect(() => {
    scene.set({ services: selectedId && services.data ? { buildingId: selectedId, pois: services.data.pois } : null });
  }, [selectedId, services.data]);

  const hasData = all.length > 0;
  useEffect(() => {
    if (!street || !hasData || selectedId) return;
    setPadding({ left: LEFT, right: 24, top: 80, bottom: 90 }, false);
    if (!frameStreet(street, all)) flyTo(streetCamera(street, all));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [street, hasData]);

  const close = () => {
    setSelectedId(null);
    if (street) {
      setPadding({ left: LEFT, right: 24, top: 80, bottom: 90 }, false);
      if (!frameStreet(street, all, { duration: 1500 })) flyTo(streetCamera(street, all), 1500);
    }
  };

  const ask = (question: string) => {
    setAgentOpen(true);
    void agent.ask(question);
  };

  return (
    <>
      <CandidateList
        street={street}
        streets={streets}
        onStreet={(name) => { setSelectedId(null); setChosenStreet(name); }}
        buildings={onStreet}
        summary={summary}
        selectedId={selectedId}
        onSelect={select}
        onHover={(id) => scene.set({ hoverId: id })}
        filter={filter}
        onFilter={setFilter}
        loading={buildingsQuery.isPending}
      />

      <AnimatePresence mode="wait">
        {selected ? (
          <BuildingPanel
            key={selected.id}
            building={selected}
            services={services.data}
            similar={similar.data}
            onClose={close}
            onSelect={select}
            onHumanLabel={(label) => labelMutation.mutate({ id: selected.id, label })}
            onInspection={(outcome) => inspectionMutation.mutate({ id: selected.id, outcome })}
            busy={labelMutation.isPending || inspectionMutation.isPending}
            demoData={source === "demo" || selected.source === "demo"}
          />
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {!agentOpen ? (
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="pointer-events-auto absolute bottom-5 flex -translate-x-1/2 items-center gap-2"
            style={{ left: selected ? "calc((100% - 448px + 408px) / 2)" : "calc((100% + 408px) / 2)" }}
          >
            <button type="button" onClick={() => setAgentOpen(true)} className="group inline-flex h-12 items-center gap-2.5 rounded-full bg-ink pl-2 pr-5 text-[14px] font-semibold text-white shadow-[0_14px_40px_-10px_rgba(11,16,13,0.55)] transition hover:scale-[1.02]">
              <span className="grid size-8 place-items-center rounded-full bg-volt text-ink"><Sparkles size={16} /></span>
              Ask HomesAbove
            </button>
            <button type="button" onClick={() => setEvalOpen(true)} className="glass inline-flex h-12 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-ink transition hover:scale-[1.02]">
              <BarChart3 size={16} /> Evaluation
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AgentSheet
        open={agentOpen}
        onClose={() => { setAgentOpen(false); agent.reset(); }}
        trace={agent.trace}
        onAsk={ask}
        buildingIds={all.map((b) => b.id)}
        onSelect={(id) => select(id)}
        model={import.meta.env.VITE_AGENT_MODEL || "AGENT_MODEL"}
      />
      <EvalModal open={evalOpen} onClose={() => setEvalOpen(false)} result={evalQuery.data} />
      <Toasts toasts={toasts} className={selected ? "right-[468px] top-[76px]" : "right-4 top-[76px]"} />
    </>
  );
}
