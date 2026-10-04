import { useCallback, useEffect, useRef, useState } from "react";

import { AGENT_ASK_PATH } from "../lib/api";
import { replayAgent, streamPost } from "../lib/sse";
import type { AgentEvent } from "../lib/types";
import { EMPTY_TRACE, type AgentTrace } from "./officer/AgentSheet";

function reduce(trace: AgentTrace, event: AgentEvent): AgentTrace {
  if (event.event === "tool_call") return { ...trace, calls: [...trace.calls, event.data] };
  if (event.event === "tool_result") return { ...trace, results: [...trace.results, event.data] };
  if (event.event === "delta") return { ...trace, answer: trace.answer + event.data.text };
  return {
    ...trace,
    answer: event.data.text || trace.answer,
    error: event.data.error ? event.data.text || "The agent could not complete this request." : null,
  };
}

/** Ask the agent (POST /api/agent/ask, SSE) or, with replay, play the recorded demo answer. */
export function useAgent() {
  const [trace, setTrace] = useState<AgentTrace>(EMPTY_TRACE);
  const controller = useRef<AbortController | null>(null);

  const ask = useCallback(async (question: string, options: { replay?: boolean } = {}) => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setTrace({ ...EMPTY_TRACE, question, streaming: true });
    const onEvent = (event: AgentEvent) => setTrace((t) => reduce(t, event));
    try {
      if (options.replay) await replayAgent(question, onEvent, c.signal);
      else await streamPost(AGENT_ASK_PATH, { question }, onEvent, c.signal);
    } catch (error) {
      if (!c.signal.aborted) setTrace((t) => ({ ...t, error: error instanceof Error ? error.message : "Please try again." }));
    } finally {
      if (controller.current === c) {
        controller.current = null;
        setTrace((t) => ({ ...t, streaming: false }));
      }
    }
  }, []);

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setTrace(EMPTY_TRACE);
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  return { trace, ask, reset };
}
