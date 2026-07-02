import { Selection } from '@uwdata/mosaic-core';
import { count, eq, gt, literal } from '@uwdata/mosaic-sql';
import { describe, expect, test } from 'vitest';

import {
  createClearClause,
  createValueClause,
  updateClauseIfChanged,
} from '../src/index';
import { waitFor } from './test-utils';

// `selection.clauses` reads the last *emitted* value event, which lags one
// tick once listeners attach; `_resolved` is the synchronously-maintained
// state `updateClauseIfChanged` itself compares against.
const resolved = (selection: Selection) => selection._resolved;

describe('updateClauseIfChanged', () => {
  test('publishes new and changed predicates, suppresses equal ones', async () => {
    const selection = Selection.intersect();
    const source = {};
    let events = 0;
    selection.addEventListener('value', () => {
      events += 1;
    });

    const clause = (n: number) =>
      createValueClause({
        source,
        value: `> ${n}`,
        predicate: gt(count(), literal(n)),
      });

    expect(updateClauseIfChanged(selection, clause(5))).toBe(true);
    expect(resolved(selection)).toHaveLength(1);

    // Same predicate SQL — suppressed: no update, no Selection event.
    expect(updateClauseIfChanged(selection, clause(5))).toBe(false);
    expect(resolved(selection)[0]!.value).toBe('> 5');

    expect(updateClauseIfChanged(selection, clause(9))).toBe(true);
    expect(resolved(selection)[0]!.value).toBe('> 9');

    // Only the two applied updates emit (rapid updates may coalesce into a
    // single dispatch); the suppressed one adds nothing.
    await waitFor(() => {
      expect(events).toBeGreaterThanOrEqual(1);
    });
    expect(events).toBeLessThanOrEqual(2);
  });

  test('suppresses clearing a source that has no active clause', () => {
    const selection = Selection.intersect();
    const source = {};

    expect(updateClauseIfChanged(selection, createClearClause(source))).toBe(
      false,
    );
    expect(resolved(selection)).toHaveLength(0);

    updateClauseIfChanged(
      selection,
      createValueClause({
        source,
        value: 'x',
        predicate: eq(literal(1), literal(1)),
      }),
    );
    expect(resolved(selection)).toHaveLength(1);

    expect(updateClauseIfChanged(selection, createClearClause(source))).toBe(
      true,
    );
    expect(resolved(selection)).toHaveLength(0);
  });
});
