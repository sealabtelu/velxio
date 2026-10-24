/**
 * serialBatcher — coalesces per-byte USART output into one store update
 * per animation frame.
 *
 * Problem: AVR/RP2040/ESP32 emit one callback per byte. A sketch running
 * `Serial.println(value)` at 200 Hz (e.g. the Half-Wave Rectifier example)
 * produces ~600 store sets/sec. React's useSyncExternalStore can't reconcile
 * that fast and eventually throws "Maximum update depth exceeded" from any
 * effect whose deps include `serialOutput.length`.
 *
 * Fix: buffer chars in memory, flush once per animation frame (≤60 Hz).
 * No semantic change — the buffer preserves byte order and groups by board.
 *
 * Frames come from frameScheduler, not raw requestAnimationFrame: a page that
 * is not being painted (background tab, iframe scrolled offscreen) gets no
 * frames, and the monitor used to stop updating while a QEMU board kept
 * sending. Where there is no requestAnimationFrame when the batcher is created
 * (Node, Vitest before a test stubs it) it uses `setTimeout(…, 0)`, decided
 * once — the store tests rely on that to flush under a no-op rAF stub.
 */

import { requestFrame } from '../simulation/frameScheduler';

export type BatchFlush = (perBoard: Map<string, string>) => void;

export interface SerialBatcher {
  append(boardId: string, ch: string): void;
  /** Immediately flush any pending bytes. Exposed for tests. */
  flushNow(): void;
}

export function createSerialBatcher(flush: BatchFlush): SerialBatcher {
  const buf = new Map<string, string>();
  let scheduled = false;

  const schedule: (cb: () => void) => void =
    typeof requestAnimationFrame === 'function'
      ? (cb) => {
          requestFrame(cb);
        }
      : (cb) => {
          setTimeout(cb, 0);
        };

  const doFlush = () => {
    scheduled = false;
    if (buf.size === 0) return;
    const snapshot = new Map(buf);
    buf.clear();
    flush(snapshot);
  };

  return {
    append(boardId, ch) {
      buf.set(boardId, (buf.get(boardId) ?? '') + ch);
      if (!scheduled) {
        scheduled = true;
        schedule(doFlush);
      }
    },
    flushNow() {
      scheduled = false;
      doFlush();
    },
  };
}
