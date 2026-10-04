import { ArrowUp, Bot, Database, LoaderCircle, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

import { cn } from "../../components/primitives";
import type { AgentToolCall, AgentToolResult } from "../../lib/types";
import { DEMO_QUESTIONS } from "../../mocks";

export type AgentTrace = {
  question: string;
  calls: AgentToolCall[];
  results: AgentToolResult[];
  answer: string;
  error: string | null;
  streaming: boolean;
};

export const EMPTY_TRACE: AgentTrace = { question: "", calls: [], results: [], answer: "", error: null, streaming: false };

const DB_OP_STYLE: Record<string, string> = {
  $geoNear: "bg-[#E8F3FF] text-[#1F5BB8]",
  $vectorSearch: "bg-[#F4EBFF] text-[#6941C6]",
  find: "bg-mint text-green-700",
  "cosine-fallback": "bg-amber/15 text-[#8A5300]",
  static: "bg-surface-alt text-muted",
};

/** Building ids in the answer become buttons that select and fly to the building. */
function Linked({ text, ids, onSelect }: { text: string; ids: Set<string>; onSelect: (id: string) => void }) {
  const parts = text.split(/\b([a-z]+_\d{2,})\b/g);
  return (
    <>
      {parts.map((part, i) =>
        ids.has(part) ? (
          <button key={i} type="button" onClick={() => onSelect(part)} className="mx-0.5 inline-flex items-center rounded-md bg-ink px-1.5 py-0 font-mono text-[11.5px] font-semibold text-volt hover:bg-ink-3">
            {part}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export default function AgentSheet({
  open, onClose, trace, onAsk, buildingIds, onSelect, model, footer,
}: {
  open: boolean;
  onClose: () => void;
  trace: AgentTrace;
  onAsk: (question: string) => void;
  buildingIds: string[];
  onSelect: (id: string) => void;
  model: string;
  footer?: ReactNode;
}) {
  const [draft, setDraft] = useState<string>(DEMO_QUESTIONS[0]);
  const scroller = useRef<HTMLDivElement>(null);
  const ids = new Set(buildingIds);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [trace.answer, trace.calls.length, trace.results.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (draft.trim()) onAsk(draft.trim());
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.section
          initial={{ y: 40, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 40, opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          className="glass pointer-events-auto absolute bottom-4 left-1/2 flex max-h-[62vh] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-panel"
          aria-label="Ask HomesAbove"
        >
          <header className="flex items-center gap-3 border-b border-black/5 px-5 py-3">
            <span className="grid size-8 place-items-center rounded-xl bg-ink text-volt"><Sparkles size={16} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold tracking-[-0.01em] text-ink">Ask HomesAbove</p>
              <p className="truncate font-mono text-[10.5px] text-muted">agent → MCP · 8 read-only tools → MongoDB Atlas · inference on TensorX (EU) · {model}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full text-muted hover:bg-black/5 hover:text-ink">
              <X size={16} />
            </button>
          </header>

          <div ref={scroller} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!trace.question ? (
              <div>
                <p className="text-[13px] text-muted">The agent only reads and recommends. Labels and inspections stay with people.</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {DEMO_QUESTIONS.map((q) => (
                    <button key={q} type="button" onClick={() => { setDraft(q); onAsk(q); }} className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-3 transition hover:border-green hover:text-green-700">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <p className="ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13px] font-medium text-white">{trace.question}</p>
                <ol className="mt-4 space-y-1.5">
                  {trace.calls.map((call, i) => {
                    const result = trace.results.find((r) => r.id === call.id);
                    return (
                      <motion.li
                        key={call.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: i * 0.03 }}
                        className="rounded-xl border border-black/5 bg-surface-alt px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          {result ? <Database size={13} className="text-green" /> : <LoaderCircle size={13} className="animate-spin text-muted" />}
                          <span className="font-mono text-[12px] font-semibold text-ink">{call.name}</span>
                          <span className="truncate font-mono text-[11px] text-faint">{JSON.stringify(call.args)}</span>
                          {result ? (
                            <span className="ml-auto flex shrink-0 items-center gap-1.5">
                              <span className={cn("rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold", DB_OP_STYLE[result.db_op] ?? "bg-surface-alt text-muted")}>{result.db_op}</span>
                              <span className="font-mono text-[10.5px] text-muted">{result.ms ?? "–"} ms</span>
                            </span>
                          ) : null}
                        </div>
                        {result ? <p className="mt-1 truncate pl-5 text-[11.5px] text-muted">{result.summary}</p> : null}
                      </motion.li>
                    );
                  })}
                </ol>
                {trace.answer ? (
                  <div className="mt-4 flex gap-2.5">
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-mint text-green-700"><Bot size={15} /></span>
                    <p className="whitespace-pre-line text-[13.5px] leading-[1.55] text-ink">
                      <Linked text={trace.answer} ids={ids} onSelect={onSelect} />
                      {trace.streaming ? <span className="ml-0.5 inline-block h-4 w-[7px] translate-y-0.5 animate-pulse rounded-sm bg-green" /> : null}
                    </p>
                  </div>
                ) : trace.streaming && trace.calls.length === 0 ? (
                  <p className="mt-4 flex items-center gap-2 text-[12px] text-muted"><LoaderCircle size={14} className="animate-spin" /> Thinking…</p>
                ) : null}
                {trace.error ? <p className="mt-3 rounded-xl bg-danger/10 px-3 py-2 text-[12px] text-danger">{trace.error}</p> : null}
              </>
            )}
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-black/5 px-3 py-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask about a street, a building or the grant"
              className="h-10 min-w-0 flex-1 rounded-full bg-surface-alt px-4 text-[13.5px] outline-none ring-green/40 focus:ring-2"
            />
            <button type="submit" disabled={trace.streaming || !draft.trim()} className="grid size-10 place-items-center rounded-full bg-ink text-volt transition hover:scale-105 disabled:opacity-40" aria-label="Ask">
              <ArrowUp size={18} strokeWidth={2.6} />
            </button>
          </form>
          {footer}
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
