/**
 * Two ways the Serial Monitor used to look hung.
 *
 * 1. The kept output grew for as long as the sketch printed. Every flush copies
 *    it and the monitor re-renders all of it, so after minutes of
 *    `Serial.println` in loop() each frame went there and the CPU loop sharing
 *    the main thread crawled. The store now keeps a bounded tail.
 * 2. An in-browser engine whose run loop threw stopped itself and told nobody:
 *    the board stayed "running", the monitor waited for bytes forever.
 */
import { describe, it, expect } from 'vitest';

const flushFrames = () => new Promise((r) => setTimeout(r, 50)); // the serial batcher flushes per frame

describe('serial output cap', () => {
  it('keeps a bounded tail that starts on a whole line and ends with the newest bytes', async () => {
    const { useSimulatorStore, appendHardwareSerial } = await import('../store/useSimulatorStore');
    const id = useSimulatorStore.getState().addBoard('arduino-uno', 10, 10);

    const line = (i: number) => `line ${String(i).padStart(6, '0')}\r\n`;
    let all = '';
    for (let i = 0; i < 30_000; i++) all += line(i);
    expect(all.length).toBeGreaterThan(256 * 1024);

    appendHardwareSerial(id, all);
    await flushFrames();
    appendHardwareSerial(id, 'newest\r\n');
    await flushFrames();

    const out = useSimulatorStore.getState().boards.find((b) => b.id === id)!.serialOutput;
    expect(out.length).toBeLessThanOrEqual(128 * 1024);
    expect(out.endsWith(line(29_999) + 'newest\r\n')).toBe(true);
    expect(out).toMatch(/^line \d{6}\r\n/);
  });

  it('leaves short output alone', async () => {
    const { useSimulatorStore, appendHardwareSerial } = await import('../store/useSimulatorStore');
    const id = useSimulatorStore.getState().addBoard('arduino-uno', 10, 10);

    appendHardwareSerial(id, 'hello\r\n');
    appendHardwareSerial(id, 'world\r\n');
    await flushFrames();

    const out = useSimulatorStore.getState().boards.find((b) => b.id === id)!.serialOutput;
    expect(out).toBe('hello\r\nworld\r\n');
  });
});

describe('in-browser engine crash', () => {
  it('marks the board stopped and says why in its monitor', async () => {
    const { useSimulatorStore, getBoardSimulator } = await import('../store/useSimulatorStore');
    const id = useSimulatorStore.getState().addBoard('arduino-uno', 10, 10);
    useSimulatorStore.setState((s) => ({
      boards: s.boards.map((b) => (b.id === id ? { ...b, running: true } : b)),
    }));

    const sim = getBoardSimulator(id) as unknown as { onCrash: ((e: unknown) => void) | null };
    expect(typeof sim.onCrash).toBe('function');
    sim.onCrash!(new Error('illegal opcode'));
    await flushFrames();

    const board = useSimulatorStore.getState().boards.find((b) => b.id === id)!;
    expect(board.running).toBe(false);
    expect(board.serialOutput).toContain('[Velxio] The simulation stopped: illegal opcode');
  });

  it('wins over the running flag startBoard sets after a crash inside start()', async () => {
    const { useSimulatorStore, getBoardSimulator } = await import('../store/useSimulatorStore');
    const id = useSimulatorStore.getState().addBoard('arduino-uno', 10, 10);
    const sim = getBoardSimulator(id) as unknown as { onCrash: ((e: unknown) => void) | null };

    // The ESP32-C3 engine runs its first frame synchronously in start().
    sim.onCrash!(new Error('boom'));
    useSimulatorStore.setState((s) => ({
      boards: s.boards.map((b) => (b.id === id ? { ...b, running: true } : b)),
    }));
    await flushFrames();

    expect(useSimulatorStore.getState().boards.find((b) => b.id === id)!.running).toBe(false);
  });

  it('the AVR run loop reports an exception through onCrash', async () => {
    const { AVRSimulator } = await import('../simulation/AVRSimulator');
    const { PinManager } = await import('../simulation/PinManager');
    let frame: FrameRequestCallback | null = null;
    const g = globalThis as Record<string, unknown>;
    const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
    g.requestAnimationFrame = (cb: FrameRequestCallback) => {
      frame = cb;
      return 1;
    };
    g.cancelAnimationFrame = () => {};
    try {
      const sim = new AVRSimulator(new PinManager(), 'uno');
      sim.loadHex(':0A0000000FEF04B900E205B9FFCFCD\n:00000001FF\n');
      const crashes: unknown[] = [];
      sim.onCrash = (e) => crashes.push(e);
      sim.start();
      // Break the CPU so the next instruction throws.
      (sim as unknown as { cpu: { tick: () => void } }).cpu.tick = () => {
        throw new Error('broken');
      };
      (frame as FrameRequestCallback | null)?.(16);

      expect(crashes).toHaveLength(1);
      expect((crashes[0] as Error).message).toBe('broken');
      expect(sim.isRunning()).toBe(false);
    } finally {
      g.requestAnimationFrame = saved.raf;
      g.cancelAnimationFrame = saved.caf;
    }
  });
});
