import { describe, expect, test, vi } from 'vitest';
import {
  buildVariableParamOptions,
  buildVariableUrlRegistry,
  createVariableUrlPersister,
  decodeParamValue,
  encodeParamValue,
  validateVariableUrl,
} from '../src/spec/url-state/variable-url';
import { buildSelectionUrlRegistry } from '../src/spec/url-state/selection-url';
import { buildFilterUrlRegistry } from '../src/spec/filter-url';
import { buildDashboardUrlInfo } from '../src/spec/url-state/info';
import type { ParamValue } from '@nozzleio/react-mosaic';
import type { FilterUrlInfo } from '../src/spec/filter-url';
import type { VariablePersisterIo } from '../src/spec/url-state/variable-url';
import type { DashboardSpec, TopologySpec } from '../src/spec/schema';
import type { Search } from '../src/router';

// ── Codec round-trip (the ParamValue value domain) ────────────────────────────

describe('encodeParamValue / decodeParamValue', () => {
  const roundTrips = (value: ParamValue): void => {
    const encoded = encodeParamValue(value);
    expect(encoded).not.toBeNull();
    const decoded = decodeParamValue(encoded as string);
    expect(decoded).not.toBeNull();
    expect((decoded as { value: ParamValue }).value).toEqual(value);
  };

  test('round-trips scalar strings (including reserved-looking and unicode)', () => {
    for (const value of [
      'title',
      'description',
      '',
      'a,b',
      'π/λ',
      'n42',
      '@x',
    ]) {
      roundTrips(value);
    }
  });

  test('round-trips numbers (integer, negative, float, zero), preserving the number type', () => {
    for (const value of [0, 42, -3.5, 1e6, -0.001]) {
      roundTrips(value);
    }
    // The decoded value is a number, never the string form.
    const decoded = decodeParamValue(encodeParamValue(42) as string);
    expect(typeof (decoded as { value: ParamValue }).value).toBe('number');
  });

  test('round-trips booleans and null, preserving their types', () => {
    roundTrips(true);
    roundTrips(false);
    roundTrips(null);
    expect(decodeParamValue('z')).toEqual({ value: null });
    expect(decodeParamValue('b1')).toEqual({ value: true });
    expect(decodeParamValue('b0')).toEqual({ value: false });
  });

  test('round-trips flat arrays (mixed types, empty, comma-bearing strings)', () => {
    roundTrips([]);
    roundTrips(['a', 'b']);
    roundTrips([1, 2, 3]);
    roundTrips(['a', 1, true, null]);
    roundTrips(['has,comma', 'plain']);
  });

  test('an empty array encodes to the bare array marker and back', () => {
    expect(encodeParamValue([])).toBe('@');
    expect(decodeParamValue('@')).toEqual({ value: [] });
  });

  test('a non-finite number is unrepresentable (encode → null)', () => {
    expect(encodeParamValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(encodeParamValue(Number.NaN)).toBeNull();
    expect(encodeParamValue([1, Number.NaN])).toBeNull();
  });

  test('malformed input decodes to null (defensive skip)', () => {
    for (const raw of ['', 'x', 'b2', 'nabc', 'z1', '@nabc', '@b2,s']) {
      expect(decodeParamValue(raw)).toBeNull();
    }
  });

  test('a decoded null is distinguishable from a decode failure via the wrapper', () => {
    expect(decodeParamValue('z')).toEqual({ value: null });
    expect(decodeParamValue('nope!')).toBeNull();
  });
});

// ── Registry (URL param derivation) ───────────────────────────────────────────

describe('buildVariableUrlRegistry', () => {
  test('derives the house-convention v.<entry> param for a persisted variable', () => {
    const topology: TopologySpec = {
      answer_field: {
        type: 'variable',
        default: 'title',
        persist: { type: 'url' },
      },
    };
    const registry = buildVariableUrlRegistry(topology);
    expect(registry.entries).toEqual([
      { entry: 'answer_field', param: 'v.answer_field' },
    ]);
    expect(registry.getByEntry('answer_field')?.param).toBe('v.answer_field');
    expect(registry.getByParam('v.answer_field')?.entry).toBe('answer_field');
  });

  test('honors an explicit param override', () => {
    const registry = buildVariableUrlRegistry({
      grain: {
        type: 'variable',
        default: 'day',
        persist: { type: 'url', param: 'g' },
      },
    });
    expect(registry.entries).toEqual([{ entry: 'grain', param: 'g' }]);
    expect(registry.getByParam('g')?.entry).toBe('grain');
  });

  test('skips variables without persist and non-variable declarations', () => {
    const registry = buildVariableUrlRegistry({
      answer_field: { type: 'variable', default: 'title' },
      brush: { type: 'single' },
      mode: { type: 'variable', default: 'x', persist: { type: 'url' } },
    });
    expect(registry.entries).toEqual([{ entry: 'mode', param: 'v.mode' }]);
  });
});

// ── Persister (router-bound read/write) ───────────────────────────────────────

describe('createVariableUrlPersister', () => {
  const io = (
    search: Search,
    commit = vi.fn(),
  ): { io: VariablePersisterIo; commit: typeof commit } => ({
    io: { search, commit },
    commit,
  });

  test('read decodes the owned param from the current URL', () => {
    const { io: value } = io({ 'v.answer_field': 'sdescription' });
    const persister = createVariableUrlPersister('v.answer_field', () => value);
    expect(persister.read({})).toBe('description');
  });

  test('read returns null when the param is absent (core keeps the default)', () => {
    const { io: value } = io({});
    const persister = createVariableUrlPersister('v.answer_field', () => value);
    expect(persister.read({})).toBeNull();
  });

  test('read returns null on a malformed param (defensive)', () => {
    const { io: value } = io({ 'v.answer_field': 'not-a-token!' });
    const persister = createVariableUrlPersister('v.answer_field', () => value);
    expect(persister.read({})).toBeNull();
  });

  test('write patches the owned param with the encoded value through the shared commit queue', () => {
    const { io: value, commit } = io({});
    const persister = createVariableUrlPersister('v.answer_field', () => value);
    persister.write('description', { reason: 'update' });
    expect(commit).toHaveBeenCalledWith({ 'v.answer_field': 'sdescription' });
  });

  test('write deletes the owned param on a nullish value', () => {
    const { io: value, commit } = io({});
    const persister = createVariableUrlPersister('v.answer_field', () => value);
    persister.write(null, { reason: 'clear' });
    expect(commit).toHaveBeenCalledWith({ 'v.answer_field': null });
  });
});

describe('buildVariableParamOptions', () => {
  test('keys one persist option per persisted variable entry', () => {
    const registry = buildVariableUrlRegistry({
      answer_field: {
        type: 'variable',
        default: 'title',
        persist: { type: 'url' },
      },
    });
    const options = buildVariableParamOptions(registry, () => ({
      search: {},
      commit: vi.fn(),
    }));
    expect(Object.keys(options ?? {})).toEqual(['answer_field']);
    expect(typeof options?.answer_field?.persist.read).toBe('function');
  });

  test('returns undefined when no variable persists (no topology recreation churn)', () => {
    const registry = buildVariableUrlRegistry({
      answer_field: { type: 'variable', default: 'title' },
    });
    expect(
      buildVariableParamOptions(registry, () => ({
        search: {},
        commit: vi.fn(),
      })),
    ).toBeUndefined();
  });
});

// ── Collision validation ──────────────────────────────────────────────────────

describe('validateVariableUrl', () => {
  const emptyFilters = buildFilterUrlRegistry(
    { filters: { fields: [] }, widgets: {} } as unknown as DashboardSpec,
    {},
  );
  const noSelections = buildSelectionUrlRegistry({});

  test('accepts non-colliding variable params', () => {
    const registry = buildVariableUrlRegistry({
      answer_field: {
        type: 'variable',
        default: 'title',
        persist: { type: 'url' },
      },
    });
    expect(
      validateVariableUrl(registry, emptyFilters, null, noSelections),
    ).toEqual([]);
  });

  test('rejects the reserved spec param', () => {
    const registry = buildVariableUrlRegistry({
      x: {
        type: 'variable',
        default: 't',
        persist: { type: 'url', param: 'spec' },
      },
    });
    const errors = validateVariableUrl(
      registry,
      emptyFilters,
      null,
      noSelections,
    );
    expect(errors.some((error) => error.includes("reserved 'spec'"))).toBe(
      true,
    );
  });

  test('rejects a collision with a prefixed filter namespace', () => {
    const registry = buildVariableUrlRegistry({
      x: {
        type: 'variable',
        default: 't',
        persist: { type: 'url', param: 'f.anything' },
      },
    });
    const errors = validateVariableUrl(
      registry,
      emptyFilters,
      { entryName: 'filters', prefix: 'f' },
      noSelections,
    );
    expect(
      errors.some((error) => error.includes('persisted filter param')),
    ).toBe(true);
  });

  test('rejects a collision with a persisted selection param', () => {
    const selections = buildSelectionUrlRegistry({
      volume_brush: {
        type: 'single',
        persist: {
          type: 'url',
          value: {
            type: 'interval',
            column: 'search_volume',
            data_type: 'number',
          },
        },
      },
    });
    const registry = buildVariableUrlRegistry({
      x: {
        type: 'variable',
        default: 't',
        persist: { type: 'url', param: 's.volume_brush' },
      },
    });
    const errors = validateVariableUrl(
      registry,
      emptyFilters,
      null,
      selections,
    );
    expect(
      errors.some((error) => error.includes('persisted selection param')),
    ).toBe(true);
  });

  test('rejects two variables owning the same param', () => {
    const registry = buildVariableUrlRegistry({
      a: {
        type: 'variable',
        default: 1,
        persist: { type: 'url', param: 'dup' },
      },
      b: {
        type: 'variable',
        default: 2,
        persist: { type: 'url', param: 'dup' },
      },
    });
    const errors = validateVariableUrl(
      registry,
      emptyFilters,
      null,
      noSelections,
    );
    expect(
      errors.some((error) => error.includes('another persisted variable')),
    ).toBe(true);
  });
});

// ── Ownership classification (the popover's 4th class) ─────────────────────────

describe('buildDashboardUrlInfo variable ownership', () => {
  const inertFilters: FilterUrlInfo = {
    enabled: false,
    prefix: undefined,
    classify: () => 'other',
    describe: () => null,
  };

  test('classifies an owned variable param and describes its decoded value', () => {
    const variables = buildVariableUrlRegistry({
      answer_field: {
        type: 'variable',
        default: 'title',
        persist: { type: 'url' },
      },
    });
    const info = buildDashboardUrlInfo(
      inertFilters,
      buildSelectionUrlRegistry({}),
      variables,
    );
    expect(info.classify('v.answer_field')).toBe('variable');
    expect(info.classify('foreign')).toBe('other');
    expect(info.describe('v.answer_field', 'sdescription')).toBe('description');
    // An array value renders comma-joined.
    expect(info.describe('v.answer_field', '@sa,sb')).toBe('a, b');
    // A malformed value decodes to null → no description.
    expect(info.describe('v.answer_field', 'nope!')).toBeNull();
  });
});
