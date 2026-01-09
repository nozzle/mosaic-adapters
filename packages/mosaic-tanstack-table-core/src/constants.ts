/**
 * Global constants used throughout the Mosaic Table Core logic.
 * These identifiers ensure consistent signaling between decoupled components
 * (e.g., between the Selection Registry and Facet Menus).
 */

/**
 * A Sentinel Identifier used to detect a "Global Reset" event.
 * When a Selection update source has this ID, listeners should treat it
 * as a hard reset (clearing local state, search terms, etc.) rather than
 * a standard filter change.
 */
export const GLOBAL_RESET_ID = 'MosaicGlobalReset';

/**
 * A standard source object representing a Global Reset.
 * Can be passed to `selection.update({ source: GlobalResetSource, ... })`.
 */
export const GlobalResetSource = {
  id: GLOBAL_RESET_ID,
  toString: () => GLOBAL_RESET_ID,
} as const;
