/**
 * frameScheduler drives the in-browser CPU loops and the serial batcher. A page
 * the browser is not painting (background tab, iframe scrolled offscreen or
 * display:none) gets no animation frames, and the simulation used to freeze
 * there with the Serial Monitor silent — read by users as a hang, most often
 * with Velxio embedded in a dashboard iframe.
 *
 * It must fall back to a timer ONLY on an explicit "not painted" signal: the
 * other tests stub requestAnimationFrame as a no-op to step the CPU by hand,
 * and a loop that started itself on a timer would run under them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Listener = () => void;

function fakeDocument() {
  const listeners: Listener[] = [];
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    documentElement: {},
    addEventListener: (type: string, fn: Listener) => {
      if (type === 'visibilitychange') listeners.push(fn);
    },
  };
  return {
    doc,
    setVisibility(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      for (const fn of listeners) fn();
    },
  };
}

function fakeIntersectionObserver() {
  let callback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
  class IO {
    constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
      callback = cb;
    }
    observe() {}
    disconnect() {}
  }
  return {
    IO,
    setIntersecting(isIntersecting: boolean) {
      callback?.([{ isIntersecting }]);
    },
  };
}

describe('frameScheduler', () => {
  let rafCallbacks: FrameRequestCallback[];
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    rafCallbacks = [];
    raf = vi.fn((cb: FrameRequestCallback) => rafCallbacks.push(cb));
    caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses animation frames while the page is painted, and never a timer', async () => {
    const page = fakeDocument();
    vi.stubGlobal('document', page.doc);
    const { requestFrame } = await import('../simulation/frameScheduler');

    const cb = vi.fn();
    requestFrame(cb);
    expect(raf).toHaveBeenCalledTimes(1);

    // A no-op rAF stub (what the CPU tests use) must stay a no-op.
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();

    rafCallbacks[0](123);
    expect(cb).toHaveBeenCalledWith(123);
  });

  it('moves a pending frame to a timer when the tab is hidden', async () => {
    const page = fakeDocument();
    vi.stubGlobal('document', page.doc);
    const { requestFrame } = await import('../simulation/frameScheduler');

    const cb = vi.fn();
    requestFrame(cb);
    page.setVisibility('hidden');

    expect(caf).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);

    // The frame that went to the timer must not fire a second time.
    rafCallbacks[0]?.(0);
    expect(cb).toHaveBeenCalledTimes(1);

    // Frames requested while hidden go straight to the timer.
    requestFrame(cb);
    expect(raf).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('falls back to a timer while the iframe is outside the top-level viewport', async () => {
    const page = fakeDocument();
    const io = fakeIntersectionObserver();
    vi.stubGlobal('document', page.doc);
    vi.stubGlobal('IntersectionObserver', io.IO);
    const { requestFrame } = await import('../simulation/frameScheduler');

    const cb = vi.fn();
    requestFrame(cb);
    io.setIntersecting(false);
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);

    // Scrolled back into view: frames come from rAF again.
    io.setIntersecting(true);
    requestFrame(cb);
    expect(raf).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('a timer frame pending when the page is painted again goes back to rAF', async () => {
    const page = fakeDocument();
    vi.stubGlobal('document', page.doc);
    const { requestFrame } = await import('../simulation/frameScheduler');

    page.setVisibility('hidden');
    const cb = vi.fn();
    requestFrame(cb);
    page.setVisibility('visible');

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    expect(raf).toHaveBeenCalledTimes(1);
    rafCallbacks[0](5);
    expect(cb).toHaveBeenCalledWith(5);
  });

  it('cancelFrame cancels on either clock', async () => {
    const page = fakeDocument();
    vi.stubGlobal('document', page.doc);
    const { requestFrame, cancelFrame } = await import('../simulation/frameScheduler');

    const cb = vi.fn();
    const viaRaf = requestFrame(cb);
    cancelFrame(viaRaf);
    expect(caf).toHaveBeenCalledTimes(1);

    page.setVisibility('hidden');
    const viaTimer = requestFrame(cb);
    cancelFrame(viaTimer);
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('runs on a timer where there is no requestAnimationFrame (Node)', async () => {
    vi.unstubAllGlobals();
    const { requestFrame } = await import('../simulation/frameScheduler');

    const cb = vi.fn();
    requestFrame(cb);
    vi.advanceTimersByTime(16);
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
