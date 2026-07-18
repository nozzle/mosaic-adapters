/**
 * Tests for first-class Mosaic `Param` nodes in {@link createTopology}: the
 * `param` (topology-owned) and `external-param` (caller-supplied) declarations.
 *
 * Params are leaves: constructed eagerly, resolved via `resolveParam`, never
 * composed / cascaded / used as a filter-set context, and never observed for
 * active clauses. Construction is validation, so most cases assert either a
 * resolved Param or the exact `Error` message on the first violation.
 */
import { Param, clausePoint } from '@uwdata/mosaic-core';
import { describe, expect, test, vi } from 'vitest';

import { createTopology } from '../src/index';
import type { ParamValue, Persister } from '../src/index';

/**
 * Minimal in-memory {@link Persister} for `ParamValue`, recording every write
 * and its reason. `read` is synchronous by default so hydration applies before
 * construction returns (mirroring the filter-set persistence path).
 */
function memoryParamPersister(initial?: ParamValue | null): {
  persister: Persister<ParamValue>;
  writes: Array<{ state: ParamValue | null; reason: string }>;
} {
  let stored: ParamValue | null | undefined = initial;
  const writes: Array<{ state: ParamValue | null; reason: string }> = [];
  const persister: Persister<ParamValue> = {
    read: () => stored,
    write: (state, context) => {
      stored = state;
      writes.push({ state, reason: context.reason });
    },
  };
  return { persister, writes };
}

describe('createTopology — param resolution', () => {
  test('owned param resolves to a Param carrying its declared default', () => {
    const topology = createTopology({
      p: { type: 'param', default: 7 },
    });

    const param = topology.resolveParam('p');
    expect(param).toBeInstanceOf(Param);
    expect(param.value).toBe(7);
    // The same instance is exposed on the params record.
    expect(topology.params.p).toBe(param);
    topology.destroy();
  });

  test('the typed resolveParam form asserts the value type without a cast', () => {
    const topology = createTopology({
      metric: { type: 'param', default: 'gold' },
    });

    // Compile-time coverage: `<string>` flows to the returned Param, so `value`
    // is `string | ...` without an `as Param<string>` cast. Runtime is unchanged.
    const param = topology.resolveParam<string>('metric');
    const value: string | null | undefined = param.value;
    expect(value).toBe('gold');
    expect(param).toBe(topology.params.metric);
    topology.destroy();
  });

  test('owned param supports array and null defaults', () => {
    const topology = createTopology({
      list: { type: 'param', default: ['a', 'b'] },
      empty: { type: 'param', default: null },
    });

    expect(topology.resolveParam('list').value).toEqual(['a', 'b']);
    expect(topology.resolveParam('empty').value).toBeNull();
    topology.destroy();
  });

  test('external-param resolves to the supplied instance', () => {
    const external = Param.value(42);
    const topology = createTopology(
      { p: { type: 'external-param' } },
      { params: { p: external } },
    );

    expect(topology.resolveParam('p')).toBe(external);
    expect(topology.params.p).toBe(external);
    topology.destroy();
  });

  test('params record holds every param entry keyed by name', () => {
    const external = Param.value('x');
    const topology = createTopology(
      {
        owned: { type: 'param', default: 1 },
        supplied: { type: 'external-param' },
        sel: { type: 'crossfilter' },
      },
      { params: { supplied: external } },
    );

    expect(Object.keys(topology.params).sort()).toEqual(['owned', 'supplied']);
    topology.destroy();
  });

  test('validNames includes bare param entries', () => {
    const external = Param.value(0);
    const topology = createTopology(
      {
        owned: { type: 'param', default: 1 },
        supplied: { type: 'external-param' },
        sel: { type: 'intersect' },
      },
      { params: { supplied: external } },
    );

    expect([...topology.validNames].sort()).toEqual(
      ['owned', 'sel', 'supplied'].sort(),
    );
    topology.destroy();
  });
});

describe('createTopology — param validation errors', () => {
  test('supplied param without a declaration throws', () => {
    const p = Param.value(1);
    expect(() => createTopology({}, { params: { p } })).toThrow(
      /options\.params\['p'\] was supplied but no entry 'p' is declared/,
    );
  });

  test('supplied param for a non-external-param declaration throws', () => {
    const p = Param.value(1);
    expect(() =>
      createTopology({ p: { type: 'intersect' } }, { params: { p } }),
    ).toThrow(/declared as 'intersect', not 'external-param'/);
  });

  test('external-param without a supplied instance throws', () => {
    expect(() => createTopology({ p: { type: 'external-param' } })).toThrow(
      /declared 'external-param' but no instance was supplied/,
    );
  });

  test('a param used in a compose include throws', () => {
    const topology = () =>
      createTopology({
        p: { type: 'param', default: 1 },
        combined: { type: 'compose', include: ['p'] },
      });
    expect(topology).toThrow(
      /compose entry 'combined' references param entry 'p'.*cannot be composed/s,
    );
  });

  test('a param used as a cascading key throws', () => {
    const topology = () =>
      createTopology({
        p: { type: 'param', default: 1 },
        cascade: { type: 'cascading', keys: ['p'] },
      });
    expect(topology).toThrow(
      /cascading entry 'cascade' references param entry 'p'.*cannot be cascaded/s,
    );
  });

  test('a param used as a cascading external throws', () => {
    const topology = () =>
      createTopology({
        a: { type: 'crossfilter' },
        p: { type: 'param', default: 1 },
        cascade: { type: 'cascading', keys: ['a'], externals: ['p'] },
      });
    expect(topology).toThrow(
      /cascading entry 'cascade' references param entry 'p'.*cannot be cascaded/s,
    );
  });

  test('a param used as a filter-set context throws', () => {
    const topology = () =>
      createTopology({
        p: { type: 'param', default: 1 },
        filters: {
          type: 'filter-set',
          targets: { where: 'crossfilter' },
          context: 'p',
        },
      });
    expect(topology).toThrow(
      /filter-set entry 'filters' references param entry 'p'.*cannot be used as a filter-set context/s,
    );
  });
});

describe('createTopology — resolve / resolveParam cross-type errors', () => {
  test('resolve() on a param entry directs to resolveParam', () => {
    const topology = createTopology({ p: { type: 'param', default: 1 } });
    expect(() => topology.resolve('p')).toThrow(
      /param entry 'p' \(type 'param'\); resolve it with resolveParam\('p'\)/,
    );
    topology.destroy();
  });

  test('resolveParam() on a selection entry directs to resolve', () => {
    const topology = createTopology({ s: { type: 'intersect' } });
    expect(() => topology.resolveParam('s')).toThrow(
      /entry 's' \(type 'intersect'\), which is not a param; resolve it with resolve\('s'\)/,
    );
    topology.destroy();
  });

  test('resolveParam() on an undeclared ref lists the undeclared entry', () => {
    const topology = createTopology({ p: { type: 'param', default: 1 } });
    expect(() => topology.resolveParam('typo')).toThrow(
      /undeclared entry 'typo'/,
    );
    topology.destroy();
  });

  test('resolveParam() on a dotted ref throws (params have no children)', () => {
    const topology = createTopology({ p: { type: 'param', default: 1 } });
    expect(() => topology.resolveParam('p.child')).toThrow(
      /addresses a child of param entry 'p', but params have no children/,
    );
    topology.destroy();
  });
});

describe('createTopology — param reset() semantics', () => {
  test('reset restores an owned param to its default', () => {
    const topology = createTopology({ p: { type: 'param', default: 5 } });
    const param = topology.resolveParam('p');
    param.update(99);
    expect(param.value).toBe(99);

    topology.reset();

    expect(param.value).toBe(5);
    topology.destroy();
  });

  test('reset:false opts an owned param out of reset', () => {
    const topology = createTopology({
      p: { type: 'param', default: 5, reset: false },
    });
    const param = topology.resolveParam('p');
    param.update(99);

    topology.reset();

    expect(param.value).toBe(99);
    topology.destroy();
  });

  test('reset skips external params (not owned)', () => {
    const external = Param.value(1);
    const topology = createTopology(
      { p: { type: 'external-param' } },
      { params: { p: external } },
    );
    external.update(2);

    topology.reset();

    expect(external.value).toBe(2);
    topology.destroy();
  });
});

describe('createTopology — params and active clauses', () => {
  test('params are never enumerated as active clauses', () => {
    const external = Param.value(0);
    const topology = createTopology(
      {
        owned: { type: 'param', default: 1 },
        supplied: { type: 'external-param' },
        a: { type: 'crossfilter' },
      },
      { params: { supplied: external } },
    );

    // Updating a param does not surface an active clause.
    topology.resolveParam('owned').update(2);
    external.update(3);
    expect(topology.activeClauses.state.clauses).toHaveLength(0);

    // A genuine foreign clause on the selection still surfaces.
    const a = topology.resolve('a');
    a.update(
      clausePoint('sport', 'swim', {
        source: { column: 'sport', value: 'swim' } as object,
      }),
    );
    expect(topology.activeClauses.state.clauses).toHaveLength(1);
    topology.destroy();
  });
});

describe('createTopology — owned param persistence', () => {
  test('a non-nullish persisted value wins over the declared default', () => {
    const { persister } = memoryParamPersister(99);
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );

    expect(topology.resolveParam('p').value).toBe(99);
    topology.destroy();
  });

  test('an absent persisted value falls back to the default', () => {
    const { persister } = memoryParamPersister();
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );

    expect(topology.resolveParam('p').value).toBe(5);
    topology.destroy();
  });

  test('a null persisted value falls back to the default', () => {
    const { persister } = memoryParamPersister(null);
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );

    expect(topology.resolveParam('p').value).toBe(5);
    topology.destroy();
  });

  test('hydration does not echo a write back to the persister', () => {
    const { persister, writes } = memoryParamPersister(99);
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );

    expect(topology.resolveParam('p').value).toBe(99);
    // The hydrated value replays through the same 'value' path as a user
    // update, but the lifecycle suppresses the echo.
    expect(writes).toHaveLength(0);
    topology.destroy();
  });

  test('a value update writes through to the persister', () => {
    const { persister, writes } = memoryParamPersister();
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );

    topology.resolveParam('p').update(42);

    expect(writes).toEqual([{ state: 42, reason: 'update' }]);
    topology.destroy();
  });

  test('reset-to-default writes through the same value path', async () => {
    const { persister, writes } = memoryParamPersister();
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );
    const param = topology.resolveParam('p');

    param.update(42);
    await param.pending('value');
    topology.reset();
    // A value listener makes Param's dispatch async-queue back-to-back updates;
    // let the reset-to-default emit settle before asserting.
    await param.pending('value');

    expect(param.value).toBe(5);
    expect(writes).toEqual([
      { state: 42, reason: 'update' },
      { state: 5, reason: 'update' },
    ]);
    topology.destroy();
  });

  test('destroy stops write-through', () => {
    const { persister, writes } = memoryParamPersister();
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );
    const param = topology.resolveParam('p');

    topology.destroy();
    writes.length = 0;
    param.update(123);

    expect(writes).toHaveLength(0);
  });

  test('destroy does not write to the persister', () => {
    const { persister, writes } = memoryParamPersister(99);
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );

    topology.destroy();

    expect(writes).toHaveLength(0);
  });

  test('an async persisted value hydrates once resolved', async () => {
    const persister: Persister<ParamValue> = {
      read: () => Promise.resolve(99),
      write: vi.fn(),
    };
    const topology = createTopology(
      { p: { type: 'param', default: 5 } },
      { paramOptions: { p: { persist: persister } } },
    );

    // Async read does not block: the param starts at its default.
    expect(topology.resolveParam('p').value).toBe(5);
    await Promise.resolve();
    expect(topology.resolveParam('p').value).toBe(99);
    expect(persister.write).not.toHaveBeenCalled();
    topology.destroy();
  });
});

describe('createTopology — param persistence validation errors', () => {
  test('paramOptions on an unknown entry throws', () => {
    const { persister } = memoryParamPersister();
    expect(() =>
      createTopology({}, { paramOptions: { p: { persist: persister } } }),
    ).toThrow(
      /options\.paramOptions\['p'\] was supplied but no entry 'p' is declared/,
    );
  });

  test('paramOptions on an external-param entry throws', () => {
    const { persister } = memoryParamPersister();
    const external = Param.value(1);
    expect(() =>
      createTopology(
        { p: { type: 'external-param' } },
        {
          params: { p: external },
          paramOptions: { p: { persist: persister } },
        },
      ),
    ).toThrow(
      /options\.paramOptions\['p'\] was supplied but entry 'p' is declared as 'external-param', not 'param'; param persistence applies only to topology-owned params/,
    );
  });

  test('paramOptions on a selection entry throws', () => {
    const { persister } = memoryParamPersister();
    expect(() =>
      createTopology(
        { s: { type: 'intersect' } },
        { paramOptions: { s: { persist: persister } } },
      ),
    ).toThrow(
      /options\.paramOptions\['s'\] was supplied but entry 's' is declared as 'intersect', not 'param'/,
    );
  });
});

describe('createTopology — param destroy guard', () => {
  test('destroy leaves external params untouched and marks destroyed', () => {
    const external = Param.value(1);
    external.update(7);
    const topology = createTopology(
      { p: { type: 'external-param' } },
      { params: { p: external } },
    );

    topology.destroy();

    expect(topology.destroyed).toBe(true);
    // The external instance is never owned, so its value survives.
    expect(external.value).toBe(7);
    // Accessors mirror resolve()/filterSets — still readable after destroy.
    expect(topology.resolveParam('p')).toBe(external);
    expect(topology.params.p).toBe(external);
  });
});
