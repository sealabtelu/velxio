/**
 * Build-time board allow-list: `VITE_ENABLED_BOARDS`.
 *
 * A self-hosted build that only teaches Arduino does not want students
 * scrolling past thirty ESP32 / STM32 / Raspberry Pi cards. Setting
 *
 *   VITE_ENABLED_BOARDS=arduino            # Uno, Nano, Mega
 *   VITE_ENABLED_BOARDS=avr                # + ATtiny85
 *   VITE_ENABLED_BOARDS=arduino-uno,esp32  # any mix of kinds and groups
 *
 * at build time narrows every place a user CHOOSES a board — the component
 * picker, the New Project dialog and the examples gallery — to that list.
 * Unset, empty or `all` keeps today's behaviour (every board).
 *
 * It is a UI scope, not a security boundary: a `.vlx` file, a Wokwi import or
 * a deep link to an example that uses another board still loads. Whether that
 * board can then run is the backend's answer (an image built with
 * VELXIO_PROFILE=arduino has no ESP32 toolchain or emulator at all) — see
 * docs/wiki/board-allow-list.md.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time, so the list is fixed
 * per bundle; changing it needs a rebuild.
 */

import type { BoardKind } from '../types/board';

/** Shorthands accepted alongside raw board kinds. */
export const BOARD_GROUPS: Readonly<Record<string, readonly BoardKind[]>> = {
  arduino: ['arduino-uno', 'arduino-nano', 'arduino-mega'],
  avr: ['arduino-uno', 'arduino-nano', 'arduino-mega', 'attiny85'],
};

/**
 * Parse the raw env value. `null` means "no restriction". Tokens are
 * comma-separated, case-insensitive, and may be group names; unknown kinds are
 * kept as-is because overlay boards register after this module loads.
 */
export function parseEnabledBoards(raw: string | undefined): ReadonlySet<string> | null {
  const tokens = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0 || tokens.includes('all')) return null;
  const out = new Set<string>();
  for (const token of tokens) {
    for (const kind of BOARD_GROUPS[token] ?? [token]) out.add(kind);
  }
  return out;
}

const ENABLED = parseEnabledBoards(import.meta.env.VITE_ENABLED_BOARDS as string | undefined);

/** True when this build was given a board allow-list. */
export function isBoardAllowListActive(): boolean {
  return ENABLED !== null;
}

/** May the user pick this board kind in this build? */
export function isBoardEnabled(kind: string): boolean {
  return ENABLED === null || ENABLED.has(kind);
}
