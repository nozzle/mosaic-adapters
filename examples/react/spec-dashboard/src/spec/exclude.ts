/**
 * Compile a widget's `exclude` spec field into the data-hook options that
 * express it. The spec's declarative `exclude` (see `excludeSchema`) maps onto
 * the library's `filterBy` / `skipSources` hook options:
 *
 * - a list of filter spec ids → `skipSources: Set<ids>`, passed ALONGSIDE the
 *   resolved `filterBy` (and `havingBy`, when the widget has one). The core drops
 *   every clause whose `source.id` is in the set from both the WHERE and HAVING
 *   resolution, while every other active filter still applies.
 * - `'all'` → drop `filterBy` (and `havingBy`) entirely — the pre-existing
 *   opt-out path, NOT translated to `skipSources`.
 *
 * `exclude` is only meaningful with a `filter_by` (validation rejects it
 * otherwise), so the `omitFilterBy` flag is what a widget consults to decide
 * whether to pass its resolved selections at all.
 */
import type { ExcludeSpec } from './schema';

/** The hook-option shape a compiled `exclude` contributes to a widget's client. */
export interface CompiledExclude {
  /**
   * True for `exclude: 'all'`: the widget must pass NEITHER `filterBy` nor
   * `havingBy` (a full opt-out), and there is no `skipSources`.
   */
  omitFilterBy: boolean;
  /**
   * Clause sources to skip in the resolved `filterBy` / `havingBy`, for the list
   * form. `undefined` when nothing is skipped (no `exclude`, or `'all'`).
   */
  skipSources: ReadonlySet<string> | undefined;
}

/**
 * Translate an optional `exclude` field into {@link CompiledExclude}. Pure and
 * cheap; callers memoize on the (stable, post-compile) `exclude` reference so the
 * derived `skipSources` set keeps a stable identity across renders.
 */
export function compileExclude(
  exclude: ExcludeSpec | undefined,
): CompiledExclude {
  if (exclude === undefined) {
    return { omitFilterBy: false, skipSources: undefined };
  }
  if (exclude === 'all') {
    return { omitFilterBy: true, skipSources: undefined };
  }
  return { omitFilterBy: false, skipSources: new Set(exclude) };
}
