/**
 * VITE_ENABLED_BOARDS parsing — the build-time board allow-list
 * (lib/enabledBoards.ts, docs/wiki/board-allow-list.md).
 *
 * Pure Vitest unit tests — no DOM.
 */

import { describe, it, expect } from 'vitest';
import { parseEnabledBoards, isBoardEnabled, isBoardAllowListActive } from '../lib/enabledBoards';

describe('parseEnabledBoards', () => {
  it('treats unset, empty and "all" as no restriction', () => {
    expect(parseEnabledBoards(undefined)).toBeNull();
    expect(parseEnabledBoards('')).toBeNull();
    expect(parseEnabledBoards(' , ')).toBeNull();
    expect(parseEnabledBoards('all')).toBeNull();
    expect(parseEnabledBoards('arduino-uno,ALL')).toBeNull();
  });

  it('expands the arduino group to Uno, Nano and Mega', () => {
    expect([...parseEnabledBoards('arduino')!].sort()).toEqual([
      'arduino-mega',
      'arduino-nano',
      'arduino-uno',
    ]);
  });

  it('expands the avr group to include the ATtiny85', () => {
    expect(parseEnabledBoards('avr')!.has('attiny85')).toBe(true);
  });

  it('mixes kinds and groups, trimming and lower-casing tokens', () => {
    const set = parseEnabledBoards(' Arduino , esp32 ,xiao-esp32c6')!;
    expect(set.has('arduino-uno')).toBe(true);
    expect(set.has('esp32')).toBe(true);
    // Overlay kinds register after load, so unknown kinds are kept verbatim.
    expect(set.has('xiao-esp32c6')).toBe(true);
    expect(set.has('esp32-s3')).toBe(false);
  });
});

describe('isBoardEnabled (test build, no VITE_ENABLED_BOARDS)', () => {
  it('allows every board when the flag is unset', () => {
    expect(isBoardAllowListActive()).toBe(false);
    expect(isBoardEnabled('esp32')).toBe(true);
    expect(isBoardEnabled('stm32-bluepill')).toBe(true);
  });
});
