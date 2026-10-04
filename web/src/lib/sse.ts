import { useEffect, useRef } from 'react'
import { getMockAgentTranscript, untimedAgentEvent } from '../mocks'
import { isLocalData, isStaticDataMode, markApiUnavailable } from './data-mode'
import type { AgentEvent, HomesAboveEvent, HomesAboveEventType, TimedAgentEvent } from './types'

export type EventStreamHandler = (event: HomesAboveEvent) => void
export type AgentStreamHandler = (event: AgentEvent) => void

const LOCAL_EVENT_TYPES: HomesAboveEventType[] = [
  'building.updated',
  'inspection.recorded',
  'badge.awarded',
]

const localListeners = new Set<EventStreamHandler>()

/** Used by the static API adapter to make writes observable just like SSE. */
export function emitLocalEvent(event: HomesAboveEvent) {
  for (const listener of localListeners) listener(event)
}

export function subscribeLocalEvents(handler: EventStreamHandler) {
  localListeners.add(handler)
  return () => localListeners.delete(handler)
}

function asHomesAboveEvent(type: string, data: unknown): HomesAboveEvent | null {
  if (!LOCAL_EVENT_TYPES.includes(type as HomesAboveEventType) || !data || typeof data !== 'object') return null
  return { type, data } as HomesAboveEvent
}

/**
 * Subscribe to the API event stream. Native EventSource automatically reconnects;
 * static mode uses the same local event bus as optimistic static writes.
 */
export function useEventStream(handler: EventStreamHandler) {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    // Local writes (static or demo data) are announced on the local bus; the API on SSE.
    const unsubscribeLocal = subscribeLocalEvents((event) => handlerRef.current(event))
    if (isLocalData() || typeof EventSource === 'undefined') return () => { unsubscribeLocal() }

    const source = new EventSource('/api/events')
    const listeners = LOCAL_EVENT_TYPES.map((type) => {
      const listener = (message: MessageEvent<string>) => {
        try {
          const event = asHomesAboveEvent(type, JSON.parse(message.data) as unknown)
          if (event) handlerRef.current(event)
        } catch {
          // A malformed heartbeat or proxy response must not take down the live subscription.
        }
      }
      source.addEventListener(type, listener)
      return [type, listener] as const
    })

    return () => {
      unsubscribeLocal()
      for (const [type, listener] of listeners) source.removeEventListener(type, listener)
      source.close()
    }
  }, [])
}

function normaliseQuestion(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?!. ]+$/, '')
}

function slugForQuestion(value: string) {
  return normaliseQuestion(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'question'
}

function pause(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('The request was aborted.', 'AbortError'))
      return
    }
    const timer = window.setTimeout(resolve, Math.max(0, milliseconds))
    signal?.addEventListener('abort', () => {
      window.clearTimeout(timer)
      reject(new DOMException('The request was aborted.', 'AbortError'))
    }, { once: true })
  })
}

type AgentIndex = { questions?: Array<{ question?: string; file?: string }> }

async function replaySource(question: string): Promise<TimedAgentEvent[]> {
  if (!isStaticDataMode) return getMockAgentTranscript(question)
  try {
    const indexResponse = await fetch('/data/agent/index.json', { cache: 'no-store' })
    const index = indexResponse.ok ? (await indexResponse.json()) as AgentIndex : undefined
    const match = index?.questions?.find((entry) => entry.question && normaliseQuestion(entry.question) === normaliseQuestion(question))
    const filename = match?.file ?? `${slugForQuestion(question)}.jsonl`
    const transcriptResponse = await fetch(`/data/agent/${encodeURIComponent(filename)}`, { cache: 'no-store' })
    if (!transcriptResponse.ok) throw new Error(`No static transcript for ${filename}`)
    const events = transcriptResponse.text().then((text) => text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TimedAgentEvent))
    const resolved = await events
    return resolved.length ? resolved : getMockAgentTranscript(question)
  } catch {
    return getMockAgentTranscript(question)
  }
}

function dispatchParsedAgentEvent(event: string, data: string, onEvent: AgentStreamHandler) {
  if (!data) return
  try {
    onEvent({ event: event as AgentEvent['event'], data: JSON.parse(data) as never } as AgentEvent)
  } catch {
    // Agent events are JSON by contract; ignore incomplete proxy chunks rather than inventing content.
  }
}

async function streamResponse(response: Response, onEvent: AgentStreamHandler, signal?: AbortSignal) {
  if (!response.ok) throw new Error(`Agent request failed (${response.status})`)
  if (!response.body) throw new Error('Agent response had no readable body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'
  let dataLines: string[] = []

  const flush = () => {
    dispatchParsedAgentEvent(event, dataLines.join('\n'), onEvent)
    event = 'message'
    dataLines = []
  }

  while (true) {
    if (signal?.aborted) {
      await reader.cancel()
      throw new DOMException('The request was aborted.', 'AbortError')
    }
    const { value, done } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (!line) flush()
      else if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart())
      newline = buffer.indexOf('\n')
    }
    if (done) break
  }
  if (dataLines.length) flush()
}

/**
 * POST an agent question and parse its SSE response. EventSource cannot issue a
 * POST request, hence the fetch/ReadableStream implementation. Static mode
 * replays the exported JSONL trace at its recorded timings.
 */
export async function streamPost(
  url: string,
  body: Record<string, unknown>,
  onEvent: AgentStreamHandler,
  signal?: AbortSignal,
) {
  const replay = async () => {
    const question = typeof body.question === 'string' ? body.question : ''
    let previous = 0
    for (const record of await replaySource(question)) {
      await pause(record.t_ms - previous, signal)
      previous = record.t_ms
      onEvent(untimedAgentEvent(record))
    }
  }
  if (isLocalData()) return replay()

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    markApiUnavailable()
    return replay()
  }
  if (response.status >= 500) {
    markApiUnavailable()
    return replay()
  }
  await streamResponse(response, onEvent, signal)
}

/** Replay an agent answer from the bundled demo transcripts, at its recorded timings. */
export async function replayAgent(question: string, onEvent: AgentStreamHandler, signal?: AbortSignal) {
  let previous = 0
  for (const record of getMockAgentTranscript(question)) {
    await pause(record.t_ms - previous, signal)
    previous = record.t_ms
    onEvent(untimedAgentEvent(record))
  }
}
