/**
 * use-event-stream.ts
 *
 * The generic half of streaming: open an EventSource, hand every frame to a
 * callback, track connection state, and resume where it stopped.
 *
 * It knows nothing about turns. `use-turn-stream.ts` builds the chat state on
 * top; phase 5's knowledge-base status stream will use this same hook.
 *
 * Two things here are not obvious and are the whole reason this is a hook
 * rather than three lines in a component:
 *
 * 1. The server frame named `error` is delivered as `stream_error`. EventSource
 *    fires its OWN `error` event for every transport failure, so a server frame
 *    called `error` lands on the same listener and the two differ only by
 *    whether `.data` exists. The rename happens on the wire (Go:
 *    runtime.NameOnWire); this file is where the consequence shows up — we
 *    listen for `stream_error` for the server's version and `error` for the
 *    browser's.
 *
 * 2. EventSource reconnects on its own and replays the last `id:` it saw as
 *    `Last-Event-ID`. We do not fight that: the server honours the header, so
 *    an unattended reconnect resumes gap-free. `afterSeq` is only for the
 *    reconnects WE initiate (a remount, a tab returning from sleep), where the
 *    browser has no id to replay.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Connection state, as the UI needs to describe it. */
export type StreamStatus = "idle" | "connecting" | "open" | "closed" | "error";

/** One parsed frame: the event name from the wire plus its JSON payload. */
export type StreamFrame<T> = { name: string; seq: number; data: T };

export type UseEventStreamOptions<T> = {
  /** Same-origin URL of the stream, or null to stay disconnected. */
  url: string | null;
  /** Wire event names to subscribe to. */
  events: readonly string[];
  /** Called for every frame, in arrival order. */
  onFrame: (frame: StreamFrame<T>) => void;
  /** Resume cursor for a reconnect this code initiates. */
  afterSeq?: number;
  /** Stop and close when this returns true for a frame. */
  isTerminal?: (frame: StreamFrame<T>) => boolean;
};

export function useEventStream<T = unknown>({
  url,
  events,
  onFrame,
  afterSeq = 0,
  isTerminal,
}: UseEventStreamOptions<T>) {
  const [status, setStatus] = useState<StreamStatus>("idle");

  // The callbacks live in refs so a parent re-rendering with a new inline
  // function does not tear down and reopen the connection — which would replay
  // the stream from the cursor on every keystroke.
  const onFrameRef = useRef(onFrame);
  const isTerminalRef = useRef(isTerminal);
  onFrameRef.current = onFrame;
  isTerminalRef.current = isTerminal;

  const eventNames = events.join(",");

  // Bumping this tears the connection down and opens a fresh one. It is what
  // the UI's "try again" is wired to, for the case EventSource has given up on
  // (readyState CLOSED) and will not retry by itself.
  const [epoch, setEpoch] = useState(0);
  const reconnect = useCallback(() => setEpoch((n) => n + 1), []);

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }

    const target = new URL(url, window.location.origin);
    if (afterSeq > 0) target.searchParams.set("after_seq", String(afterSeq));

    const source = new EventSource(target.toString(), { withCredentials: true });
    setStatus("connecting");

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      source.close();
    };

    source.onopen = () => setStatus("open");

    // The browser's own transport error. `.data` is absent here, which is
    // precisely how it differs from a server frame — and why the server frame
    // is named something else.
    source.onerror = () => {
      // readyState CLOSED means it gave up; CONNECTING means it is retrying on
      // its own and will resume with Last-Event-ID, so this is not yet a
      // failure the user should be told about.
      setStatus(source.readyState === EventSource.CLOSED ? "error" : "connecting");
    };

    const handler = (name: string) => (event: MessageEvent<string>) => {
      let data: T;
      try {
        data = JSON.parse(event.data) as T;
      } catch {
        return; // a frame we cannot parse is dropped, not rendered
      }
      const frame: StreamFrame<T> = { name, seq: Number(event.lastEventId ?? 0), data };
      onFrameRef.current(frame);

      if (isTerminalRef.current?.(frame)) {
        close();
        setStatus("closed");
      }
    };

    const listeners = eventNames.split(",").filter(Boolean);
    const attached = listeners.map((name) => {
      const fn = handler(name);
      source.addEventListener(name, fn as EventListener);
      return [name, fn] as const;
    });

    return () => {
      for (const [name, fn] of attached) source.removeEventListener(name, fn as EventListener);
      close();
    };
    // afterSeq is intentionally in the dependency list: changing it IS a
    // deliberate reconnect from a new cursor.
  }, [url, eventNames, afterSeq, epoch]);

  return { status, reconnect };
}
