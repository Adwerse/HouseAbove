import { useMemo, useState } from "react";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Database,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Send,
  Wrench,
} from "lucide-react";

import type { AgentToolCall, AgentToolResult } from "../lib/types";
import { Button, Chip, Sheet } from "../ui";
import { cn, focusRingClass } from "../ui/utils";

/** Questions that are deliberately supported by the read-only council agent. */
export const AGENT_SUGGESTIONS = [
  "Where on Talbot Street should we inspect first?",
  "Why is #1 ranked first?",
  "Which buildings need a human check?",
  "Find facades similar to #1",
] as const;

/**
 * A presentation-friendly projection of the streamPost event sequence.
 * Keep calls in arrival order and results separately; AgentPanel pairs them by
 * the contract's shared `id` field so a pending MCP call stays visible.
 */
export interface AgentPanelTrace {
  toolCalls: AgentToolCall[];
  toolResults: AgentToolResult[];
  /** Accumulated delta text, replaced or completed by the final done event. */
  answer: string;
  error?: string | null;
}

export const EMPTY_AGENT_TRACE: AgentPanelTrace = {
  toolCalls: [],
  toolResults: [],
  answer: "",
  error: null,
};

export interface AgentPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Controlled question input, shared with the deterministic demo controls. */
  question: string;
  onQuestionChange: (question: string) => void;
  /** Call streamPost('/api/agent/ask', { question }, ...) from this callback. */
  onAsk: (question: string) => void;
  trace: AgentPanelTrace;
  /** Prevent duplicate requests while a streamed answer is in progress. */
  isStreaming?: boolean;
  /** A public display name only; do not pass credentials to the browser. */
  modelName?: string;
  /** Lets the answer turn known IDs into map-selection controls. */
  buildingIds?: string[];
  onSelectBuilding?: (id: string) => void;
  className?: string;
}

type TraceStep = {
  call: AgentToolCall;
  result: AgentToolResult | undefined;
};

function compactJson(value: Record<string, unknown>) {
  try {
    const text = JSON.stringify(value);
    return text.length > 88 ? `${text.slice(0, 85)}…` : text;
  } catch {
    return "{…}";
  }
}

function traceJson(step: TraceStep) {
  return JSON.stringify(
    {
      tool_call: step.call,
      tool_result: step.result ?? { state: "pending" },
    },
    null,
    2,
  );
}

function dbOperationTone(operation: string | undefined) {
  if (!operation || operation === "pending") return "neutral" as const;
  if (operation.includes("vector")) return "primary" as const;
  if (operation.includes("geo")) return "warm" as const;
  return "neutral" as const;
}

function AnswerText({
  answer,
  buildingIds,
  onSelectBuilding,
}: {
  answer: string;
  buildingIds: string[];
  onSelectBuilding?: (id: string) => void;
}) {
  const parts = useMemo(() => {
    const known = [...new Set(buildingIds.filter(Boolean))].sort((a, b) => b.length - a.length);
    // The fallback keeps useful chips in a replay even before the building list loads.
    const pattern = known.length
      ? new RegExp(`(${known.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g")
      : /\b[a-z][a-z0-9-]*[_-]\d+\b/gi;
    return answer.split(pattern).filter((part) => part.length > 0);
  }, [answer, buildingIds]);

  const knownIds = useMemo(() => new Set(buildingIds), [buildingIds]);

  return (
    <p className="whitespace-pre-wrap text-sm leading-6 text-dusk-text">
      {parts.map((part, index) => {
        const idMatch = knownIds.has(part) || (!buildingIds.length && /^\b[a-z][a-z0-9-]*[_-]\d+\b$/i.test(part));
        if (!idMatch) return <span key={`${part}-${index}`}>{part}</span>;
        return (
          <button
            key={`${part}-${index}`}
            type="button"
            className={cn(
              "mx-0.5 inline-flex items-center rounded-chip border border-dusk-primary/50 bg-dusk-primary/15 px-2 py-0.5 align-baseline font-mono text-xs font-semibold text-dusk-primary",
              "hover:border-dusk-primary hover:bg-dusk-primary/25",
              focusRingClass,
            )}
            onClick={() => onSelectBuilding?.(part)}
            title={`Select ${part} on the map`}
          >
            {part}
          </button>
        );
      })}
    </p>
  );
}

function ToolTraceRow({ step }: { step: TraceStep }) {
  const [expanded, setExpanded] = useState(false);
  const operation = step.result?.db_op || "pending";

  return (
    <li className="relative pl-7">
      <span aria-hidden="true" className="absolute left-[9px] top-5 h-[calc(100%+0.5rem)] w-px bg-white/[0.1] last:hidden" />
      <span aria-hidden="true" className="absolute left-0 top-2 grid size-[19px] place-items-center rounded-full border border-dusk-primary/45 bg-dusk-elevated text-dusk-primary">
        <Wrench size={11} />
      </span>
      <div className="overflow-hidden rounded-card border border-white/[0.07] bg-white/[0.035]">
        <button
          type="button"
          className={cn("flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-white/[0.04]", focusRingClass)}
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs font-semibold text-dusk-text">{step.call.name}</span>
              <Chip tone={dbOperationTone(operation)} label={operation} className="font-mono text-[10px]" />
              {step.result?.ms !== null && step.result?.ms !== undefined ? (
                <span className="font-mono text-[10px] text-dusk-muted">{step.result.ms} ms</span>
              ) : (
                <span className="inline-flex items-center gap-1 font-mono text-[10px] text-dusk-muted"><LoaderCircle aria-hidden="true" size={11} className="animate-spin" /> waiting</span>
              )}
            </span>
            <span className="mt-1 block truncate font-mono text-[10px] leading-4 text-dusk-muted" title={compactJson(step.call.args)}>
              args {compactJson(step.call.args)}
            </span>
            {step.result?.summary ? <span className="mt-1 block text-xs leading-4 text-dusk-muted">{step.result.summary}</span> : null}
          </span>
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-dusk-muted">{expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
        </button>
        {expanded ? (
          <pre className="max-h-52 overflow-auto border-t border-white/[0.07] bg-dusk-background/70 p-2.5 font-mono text-[10px] leading-4 text-dusk-muted">
            {traceJson(step)}
          </pre>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Controlled bottom sheet for the council agent. It deliberately contains no
 * transport logic: OfficerConsole owns streamPost, aborts, and all map state.
 */
export function AgentPanel({
  open,
  onOpenChange,
  question,
  onQuestionChange,
  onAsk,
  trace,
  isStreaming = false,
  modelName = "AGENT_MODEL",
  buildingIds = [],
  onSelectBuilding,
  className,
}: AgentPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const resultByCallId = useMemo(
    () => new Map(trace.toolResults.map((result) => [result.id, result])),
    [trace.toolResults],
  );
  const steps = useMemo<TraceStep[]>(
    () => trace.toolCalls.map((call) => ({ call, result: resultByCallId.get(call.id) })),
    [resultByCallId, trace.toolCalls],
  );
  const hasActivity = steps.length > 0 || Boolean(trace.answer) || Boolean(trace.error);

  const submit = () => {
    const nextQuestion = question.trim();
    if (!nextQuestion || isStreaming) return;
    onAsk(nextQuestion);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      title={(
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">Ask HomesAbove</span>
          <button
            type="button"
            aria-label={expanded ? "Collapse agent panel" : "Expand agent panel to half height"}
            title={expanded ? "Collapse panel" : "Expand to half height"}
            className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-white/[0.1] text-dusk-muted hover:border-dusk-primary hover:text-dusk-primary", focusRingClass)}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <Minimize2 aria-hidden="true" size={14} /> : <Maximize2 aria-hidden="true" size={14} />}
          </button>
        </span>
      )}
      description={(
        <span className="block font-mono text-[10px] leading-4">
          <span className="block">agent &gt; MCP (8 tools) &gt; MongoDB</span>
          <span className="block text-dusk-primary">inference: TensorX, EU-hosted · {modelName}</span>
        </span>
      )}
      className={cn(
        "!w-[min(100%,46rem)] !max-w-none",
        expanded ? "!h-[50dvh] !max-h-[50dvh]" : "!h-[min(22rem,43dvh)] !max-h-[43dvh]",
        className,
      )}
      contentClassName="space-y-4"
      footer={(
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="homesabove-agent-question">Ask HomesAbove</label>
            <input
              id="homesabove-agent-question"
              value={question}
              onChange={(event) => onQuestionChange(event.target.value)}
              placeholder="Ask about the survey…"
              disabled={isStreaming}
              className={cn("min-w-0 flex-1 rounded-card border border-white/[0.1] bg-dusk-background/80 px-3 py-2 text-sm text-dusk-text placeholder:text-dusk-muted/80", focusRingClass)}
            />
            <Button type="submit" size="sm" disabled={!question.trim() || isStreaming} loading={isStreaming} leadingIcon={<Send size={14} />}>
              Ask
            </Button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Suggested questions">
            {AGENT_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={isStreaming}
                onClick={() => onQuestionChange(suggestion)}
                className={cn("shrink-0 rounded-chip border border-white/[0.1] bg-white/[0.035] px-2.5 py-1 text-left text-[11px] leading-4 text-dusk-muted hover:border-dusk-primary/60 hover:bg-dusk-primary/10 hover:text-dusk-text disabled:opacity-50", focusRingClass)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </form>
      )}
      ariaLabel="Ask HomesAbove agent"
    >
      {!hasActivity ? (
        <div className="grid min-h-32 place-items-center rounded-card border border-dashed border-white/[0.1] bg-white/[0.02] px-5 py-6 text-center">
          <div>
            <Bot aria-hidden="true" className="mx-auto text-dusk-primary" size={24} />
            <p className="mt-2 text-sm font-semibold text-dusk-text">Read-only inspection guidance</p>
            <p className="mt-1 max-w-md text-xs leading-5 text-dusk-muted">The agent asks its MCP tools for current records, then recommends where a human should look first.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {steps.length ? (
            <section aria-labelledby="agent-trace-heading">
              <div className="mb-2 flex items-center gap-2">
                <Database aria-hidden="true" size={15} className="text-dusk-primary" />
                <h3 id="agent-trace-heading" className="text-xs font-semibold uppercase tracking-[0.08em] text-dusk-muted">MCP tool trace</h3>
              </div>
              <ol className="space-y-2">{steps.map((step) => <ToolTraceRow key={step.call.id} step={step} />)}</ol>
            </section>
          ) : null}

          {trace.error ? (
            <div role="alert" className="flex gap-2 rounded-card border border-status-likely-underused/40 bg-status-likely-underused/10 p-3 text-sm leading-5 text-dusk-text">
              <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-status-likely-underused" size={17} />
              <span>{trace.error}</span>
            </div>
          ) : null}

          {trace.answer ? (
            <section aria-labelledby="agent-answer-heading" className="rounded-card border border-dusk-primary/25 bg-dusk-primary/[0.07] p-3">
              <h3 id="agent-answer-heading" className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-dusk-primary">
                <Bot aria-hidden="true" size={15} /> HomesAbove answer
              </h3>
              <AnswerText answer={trace.answer} buildingIds={buildingIds} onSelectBuilding={onSelectBuilding} />
              {isStreaming ? <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-dusk-muted"><LoaderCircle aria-hidden="true" size={11} className="animate-spin" /> streaming</p> : null}
            </section>
          ) : isStreaming && !steps.length ? (
            <p className="flex items-center justify-center gap-2 py-5 font-mono text-xs text-dusk-muted"><LoaderCircle aria-hidden="true" size={13} className="animate-spin" /> Opening MCP tools…</p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}

export default AgentPanel;
