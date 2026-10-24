/**
 * frameScheduler — requestAnimationFrame that keeps ticking while the page is
 * not being painted.
 *
 * The in-browser CPU loops (AVR, RP2040, ESP32-C3, RISC-V) and the serial
 * batcher all advance once per animation frame. Browsers stop delivering frames
 * to a document they are not painting: a background tab, a minimised window,
 * and — the case that hit Velxio embedded in a dashboard iframe — a frame that
 * is display:none, zero-size or scrolled out of the top-level viewport
 * (Chromium stops rendering offscreen cross-origin frames, Firefox drops them
 * to ~1 fps). The simulation froze with no error and the Serial Monitor stopped
 * updating, which reads as a hang.
 *
 * So while the document is KNOWN not to be painted, frames are driven by a
 * timer instead. Known, not guessed from a late frame: the switch only happens
 * on an explicit signal (visibilitychange, or an IntersectionObserver putting
 * the document outside the top-level viewport). The tests stub
 * requestAnimationFrame as a no-op so they can step the CPU themselves; a
 * "frame is late" watchdog would start a free-running loop under them.
 *
 * Timers in a hidden TAB are still clamped by the browser (≥1 s), so the loops
 * slow down there. They no longer stop. An offscreen iframe in a visible tab
 * gets its full timer rate and keeps real time.
 */

/** Interval of the timer that stands in for frames while nothing is painted. */
const TIMER_FRAME_MS = 16;

interface PendingFrame {
  cb: FrameRequestCallback;
  rafId: number | null;
  timerId: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<number, PendingFrame>();
let nextId = 0;
let tabHidden = false;
let offscreen = false;
let watching = false;

function onTimerClock(): boolean {
  return tabHidden || offscreen || typeof requestAnimationFrame !== 'function';
}

function fire(id: number, timestamp: number): void {
  const frame = pending.get(id);
  if (!frame) return;
  pending.delete(id);
  frame.cb(timestamp);
}

/** Put a pending frame on whichever clock the page currently has. */
function arm(id: number, frame: PendingFrame): void {
  if (onTimerClock()) {
    if (frame.timerId !== null) return;
    if (frame.rafId !== null) {
      cancelAnimationFrame(frame.rafId);
      frame.rafId = null;
    }
    frame.timerId = setTimeout(() => fire(id, performance.now()), TIMER_FRAME_MS);
  } else {
    if (frame.rafId !== null) return;
    if (frame.timerId !== null) {
      clearTimeout(frame.timerId);
      frame.timerId = null;
    }
    frame.rafId = requestAnimationFrame((ts) => fire(id, ts));
  }
}

/** A frame requested just before the page went unpainted would never fire. */
function rearmAll(): void {
  for (const [id, frame] of pending) arm(id, frame);
}

function watchPaintState(): void {
  // Partial `document` stubs (tests) get no watching, i.e. plain rAF.
  if (watching || typeof document === 'undefined') return;
  if (typeof document.addEventListener !== 'function') return;
  watching = true;

  const onVisibility = () => {
    tabHidden = document.visibilityState === 'hidden';
    rearmAll();
  };
  document.addEventListener('visibilitychange', onVisibility);
  tabHidden = document.visibilityState === 'hidden';

  if (typeof IntersectionObserver === 'function' && document.documentElement) {
    // With no explicit root, an observer inside an iframe measures against the
    // TOP-LEVEL viewport through every ancestor frame's clip, cross-origin
    // included — the same thing the browser decides painting on.
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      offscreen = !last.isIntersecting;
      rearmAll();
    });
    io.observe(document.documentElement);
  }
}

/** Drop-in for requestAnimationFrame. The id is only valid for cancelFrame. */
export function requestFrame(cb: FrameRequestCallback): number {
  watchPaintState();
  const id = ++nextId;
  const frame: PendingFrame = { cb, rafId: null, timerId: null };
  pending.set(id, frame);
  arm(id, frame);
  return id;
}

/** Drop-in for cancelAnimationFrame, for ids from requestFrame. */
export function cancelFrame(id: number | null): void {
  if (id === null) return;
  const frame = pending.get(id);
  if (!frame) return;
  pending.delete(id);
  if (frame.rafId !== null) cancelAnimationFrame(frame.rafId);
  if (frame.timerId !== null) clearTimeout(frame.timerId);
}
