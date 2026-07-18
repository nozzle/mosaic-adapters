import { describe, expect, test } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { excludeSchema } from '../src/spec/schema';
import { compileExclude } from '../src/spec/exclude';
import { compileSpec } from '../src/spec/compile';

// ── excludeSchema (shape) ─────────────────────────────────────────────────────

describe('excludeSchema', () => {
  test('accepts a non-empty list of spec ids', () => {
    expect(excludeSchema.safeParse(['facet:domain']).success).toBe(true);
    expect(
      excludeSchema.safeParse(['facet:domain', 'text:phrase']).success,
    ).toBe(true);
  });

  test("accepts the literal 'all'", () => {
    const parsed = excludeSchema.safeParse('all');
    expect(parsed.success).toBe(true);
  });

  test('rejects garbage: empty list, empty id, wrong scalar, object', () => {
    expect(excludeSchema.safeParse([]).success).toBe(false);
    expect(excludeSchema.safeParse(['']).success).toBe(false);
    expect(excludeSchema.safeParse('everything').success).toBe(false);
    expect(excludeSchema.safeParse(42).success).toBe(false);
    expect(excludeSchema.safeParse({ all: true }).success).toBe(false);
  });
});

// ── compileExclude (compile helper → hook options) ────────────────────────────

describe('compileExclude', () => {
  test('undefined → no opt-out, no skipSources', () => {
    expect(compileExclude(undefined)).toEqual({
      omitFilterBy: false,
      skipSources: undefined,
    });
  });

  test("'all' → omit filterBy, no skipSources", () => {
    expect(compileExclude('all')).toEqual({
      omitFilterBy: true,
      skipSources: undefined,
    });
  });

  test('list → skipSources set of exactly those ids, no opt-out', () => {
    const compiled = compileExclude(['facet:domain', 'text:phrase']);
    expect(compiled.omitFilterBy).toBe(false);
    expect(compiled.skipSources).toBeInstanceOf(Set);
    expect([...compiled.skipSources!].sort()).toEqual([
      'facet:domain',
      'text:phrase',
    ]);
  });
});

// ── Cross-reference validation (via compileSpec) ──────────────────────────────

/**
 * A minimal-but-valid dashboard spec object. One filter-set with a `where`
 * target, one `page` compose, one text placement (spec id `text:phrase`), and a
 * single KPI. Tests deep-clone it, mutate one corner, stringify to YAML, and
 * compile.
 */
function baseSpec(): Record<string, unknown> {
  return {
    data: {
      tables: {
        t: {
          type: 'sql',
          query: 'SELECT 1 AS phrase, 2 AS search_volume, 3 AS domain',
        },
      },
    },
    topology: {
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
      page: { type: 'compose', as: 'crossfilter', include: ['filters.where'] },
    },
    filters: {
      fields: [
        {
          id: 'phrase',
          label: 'Phrase',
          column: 'phrase',
          value_kind: 'text',
          placements: [
            {
              label: 'WHERE',
              target: 'where',
              kind: 'condition',
              spec_id: 'text:phrase',
            },
          ],
        },
      ],
    },
    widgets: {
      k: {
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        filter_by: 'page',
        query: {
          type: 'select',
          from: 't',
          select: { value: 'count(*)' },
        },
      },
    },
    layout: { columns: 1, rows: [{ widgets: [{ ref: 'k', col_span: 1 }] }] },
  };
}

/** Deep clone the base spec, apply a mutator, and compile the resulting YAML. */
function compileMutated(
  mutate: (spec: any) => void,
): ReturnType<typeof compileSpec> {
  const spec = structuredClone(baseSpec());
  mutate(spec);
  return compileSpec(stringifyYaml(spec));
}

describe('exclude cross-reference validation', () => {
  test('the base spec compiles cleanly (sanity)', () => {
    const result = compileMutated(() => {});
    expect(result.ok).toBe(true);
  });

  test('a list exclude of a declared filter spec id compiles', () => {
    const result = compileMutated((spec) => {
      spec.widgets.k.exclude = ['text:phrase'];
    });
    expect(result.ok).toBe(true);
  });

  test("exclude: 'all' compiles", () => {
    const result = compileMutated((spec) => {
      spec.widgets.k.exclude = 'all';
    });
    expect(result.ok).toBe(true);
  });

  test('an unknown exclude id is a compile error naming it', () => {
    const result = compileMutated((spec) => {
      spec.widgets.k.exclude = ['facet:nope'];
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(
      result.errors.some(
        (error) =>
          error.includes("'facet:nope'") &&
          error.includes('not a declared filter spec id'),
      ),
    ).toBe(true);
  });

  test('exclude without filter_by is a compile error', () => {
    const result = compileMutated((spec) => {
      // Drop filter_by but keep exclude — nothing to exclude from.
      delete spec.widgets.k.filter_by;
      spec.widgets.k.exclude = ['text:phrase'];
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(
      result.errors.some((error) => error.includes('nothing to exclude from')),
    ).toBe(true);
  });

  test('a list exclude on a vgplot mark is rejected with guidance', () => {
    const result = compileMutated((spec) => {
      spec.widgets.plot = {
        renderer: 'vgplot',
        label: 'Plot',
        plot: {
          marks: [
            {
              mark: 'rectY',
              data: {
                from: 't',
                filter_by: 'page',
                exclude: ['text:phrase'],
              },
              x: { bin: 'search_volume' },
              y: { agg: 'count' },
            },
          ],
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'plot', col_span: 1 }] });
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(
      result.errors.some(
        (error) =>
          error.includes('vgplot mark cannot apply') &&
          error.includes("plot mark 'rectY'"),
      ),
    ).toBe(true);
  });

  test("exclude: 'all' on a vgplot mark compiles (opt-out form)", () => {
    const result = compileMutated((spec) => {
      spec.widgets.plot = {
        renderer: 'vgplot',
        label: 'Plot',
        plot: {
          marks: [
            {
              mark: 'rectY',
              data: { from: 't', filter_by: 'page', exclude: 'all' },
              x: { bin: 'search_volume' },
              y: { agg: 'count' },
            },
          ],
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'plot', col_span: 1 }] });
    });
    expect(result.ok).toBe(true);
  });
});
