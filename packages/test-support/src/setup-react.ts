import { cleanup, configure } from '@testing-library/react';
/**
 * Vitest setup file for React suites (`setupFiles`). Setup files run before
 * every test file even with `isolate: false`, whereas a module-level
 * `afterEach` in a shared import would only register for the first file that
 * evaluated it in each worker.
 */
import { afterEach } from 'vitest';

// Mosaic queries run against real (async) DuckDB; keep the generous poll budget
// the hand-rolled harness used so slower CI never times out mid-query.
configure({ asyncUtilTimeout: 5_000 });

// vitest runs without globals here, so RTL's auto-cleanup (which looks for a
// global `afterEach`) never registers. Wire it once, shared by every suite.
afterEach(cleanup);
