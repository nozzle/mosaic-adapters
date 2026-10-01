/**
 * React test harness on @testing-library/react. RTL provides
 * `renderHook` / `render` / `rerender` / `unmount` / `waitFor` already wrapped
 * in `act`, manages the act environment, and owns the jsdom container
 * lifecycle. Only the two Mosaic-specific helpers (`settle`, `interact`) and the
 * shared DuckDB fixtures are local. RTL cleanup and configuration live in
 * `./setup-react`, which consuming packages load through `setupFiles`.
 */
import { act } from '@testing-library/react';
import { settle as coreSettle } from './duckdb';

export { act, render, renderHook, waitFor } from '@testing-library/react';
export { createAthletesDb, createTestDb } from './duckdb';
export type { TestDb } from './duckdb';

/**
 * Elapse a timer window inside `act` so async Mosaic store pushes settle without
 * escaping the act scope. No RTL equivalent — used to assert that some window
 * produced no query / no re-render.
 */
export async function settle(ms?: number): Promise<void> {
  await act(async () => {
    await coreSettle(ms);
  });
}

/**
 * Run a state-mutating interaction inside `act`. RTL only auto-wraps DOM events
 * (`fireEvent` / `userEvent`), not direct imperative calls against Mosaic
 * objects, so imperative hook interactions still take an explicit act wrap so
 * their update is flushed before the following assertion — the pattern RTL's own
 * `renderHook` docs prescribe.
 */
export async function interact(fn: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await fn();
  });
}
