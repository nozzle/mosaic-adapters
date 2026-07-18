import { describe, expect, test } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { Param } from '@uwdata/mosaic-core';
import { collectParams, isColumnParam } from '@uwdata/mosaic-sql';
import {
  compileQuery,
  compileStructuredQuery,
  parseVariableRef,
} from '../src/spec/query-compiler';
import { buildPlotSpec } from '../src/spec/plot-interpreter';
import { compileSpec } from '../src/spec/compile';
import {
  kpiCardWidgetSchema,
  selectionTableWidgetSchema,
} from '../src/spec/schema';
import type { ExprNode, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  QuerySource,
  RowsInputs,
  ValuesInputs,
} from '@nozzleio/react-mosaic';
import type { PlotApi, PlotChannels } from '../src/spec/plot-interpreter';
import type { PlotSpec, StructuredQuery } from '../src/spec/schema';

// ── parseVariableRef (the reference grammar) ──────────────────────────────────

describe('parseVariableRef', () => {
  test('parses a bare $name (whitespace-tolerant)', () => {
    expect(parseVariableRef('$metric')).toBe('metric');
    expect(parseVariableRef('  $metric  ')).toBe('metric');
    expect(parseVariableRef('$answer_field')).toBe('answer_field');
    expect(parseVariableRef('$_x0')).toBe('_x0');
  });

  test('rejects anything that is not a whole bare $name', () => {
    // Plain columns / dotted paths / raw SQL are not refs.
    expect(parseVariableRef('metric')).toBeNull();
    expect(parseVariableRef('related_phrase.phrase')).toBeNull();
    expect(parseVariableRef('max(search_volume)')).toBeNull();
    // A `$` that is not a whole bare identifier is never a ref.
    expect(parseVariableRef('$1')).toBeNull();
    expect(parseVariableRef('$1 + 2')).toBeNull();
    expect(parseVariableRef('$metric + 1')).toBeNull();
    expect(parseVariableRef("'$5.00'")).toBeNull();
    expect(parseVariableRef('a$b')).toBeNull();
  });
});

// ── Structured column binding (case a: column named by the variable value) ────

/** Run a compiled source (always a factory for the structured path) with no predicates. */
function run(source: QuerySource<RowsInputs>): SelectQuery {
  if (typeof source !== 'function') {
    throw new Error('expected a query factory, not a table name');
  }
  return source({ where: [], having: [], inputs: {} });
}

describe('compileStructuredQuery variable binding', () => {
  const spec: StructuredQuery = {
    type: 'select',
    from: 'questions_enriched',
    select: {
      domain: 'domain',
      answer: '$answer_field',
    },
  };

  test('records the referenced variable as a dependency', () => {
    const param = Param.value('title');
    const compiled = compileStructuredQuery<RowsInputs>(spec, () => param);
    expect(compiled.variables).toEqual(['answer_field']);
  });

  test('compiles a $name column to a param-bound column named by the value', () => {
    const param = Param.value('title');
    const compiled = compileStructuredQuery<RowsInputs>(spec, () => param);

    // The variable value NAMES the selected column (quoted identifier).
    const first = String(run(compiled.source));
    expect(first).toContain('"title" AS "answer"');

    // Updating the Param renames the column on the next build — the binding is
    // live, which is what lets the client re-query on a variable change.
    param.update('description');
    const second = String(run(compiled.source));
    expect(second).toContain('"description" AS "answer"');
    expect(second).not.toContain('"title" AS "answer"');
  });

  test('a non-ref select stays a plain column and records no dependency', () => {
    const compiled = compileStructuredQuery<RowsInputs>({
      type: 'select',
      from: 't',
      select: { domain: 'domain' },
    });
    expect(compiled.variables).toEqual([]);
    expect(String(run(compiled.source))).toContain('"domain"');
  });

  test('a $name with no resolver throws (a resolver is threaded where refs are allowed)', () => {
    const compiled = compileStructuredQuery<RowsInputs>(spec);
    expect(() => run(compiled.source)).toThrow(/variable ref/);
  });

  test('the raw-template path binds no variables', () => {
    const compiled = compileQuery<RowsInputs>({
      type: 'sql',
      statement: 'SELECT 1 AS value',
    });
    expect(compiled.variables).toEqual([]);
  });

  test('compileQuery binds a structured $name column for the kpi (ValuesInputs) shape', () => {
    const param = Param.value('title');
    const compiled = compileQuery<ValuesInputs>(
      { type: 'select', from: 't', select: { value: '$answer_field' } },
      () => param,
    );
    expect(compiled.variables).toEqual(['answer_field']);
    const source = compiled.source;
    if (typeof source !== 'function') {
      throw new Error('expected a query factory, not a table name');
    }
    // The variable value NAMES the `value` column the kpi card reads back.
    expect(String(source({ where: [], having: [], inputs: {} }))).toContain(
      '"title" AS "value"',
    );
  });
});

// ── vgplot channel binding (the Param handed to the api call) ─────────────────

/** A PlotApi stub that records the channel object handed to the mark builder. */
function capturingPlotApi(): { api: PlotApi; captured: () => PlotChannels } {
  let channels: PlotChannels = {};
  const api = {
    from: () => ({}),
    rectY: (_data: unknown, ch: PlotChannels) => {
      channels = ch;
      return 'mark';
    },
  } as unknown as PlotApi;
  return { api, captured: () => channels };
}

describe('buildPlotSpec variable channel binding', () => {
  test('a $name channel compiles to a column(param) that carries the Param', () => {
    const param = Param.value('volume_bucket');
    const plot: PlotSpec = {
      marks: [
        {
          mark: 'rectY',
          data: { from: 'questions_enriched' },
          x: '$grain',
          fill: '$grain',
        },
      ],
    };
    const { api, captured } = capturingPlotApi();
    buildPlotSpec(plot, {
      api,
      resolveSelection: () => undefined,
      resolveVariable: () => param,
      geometry: {},
    });

    const channels = captured();
    // Both a positional (x) and a color (fill) $name channel become a dynamic
    // column reference the vgplot mark can collect as a Param.
    for (const key of ['x', 'fill'] as const) {
      expect(isColumnParam(channels[key])).toBe(true);
      const params = [...collectParams(channels[key] as ExprNode)];
      expect(params).toContain(param);
    }
  });

  test('a non-ref channel is unchanged (plain column string passes through)', () => {
    const plot: PlotSpec = {
      marks: [{ mark: 'rectY', data: { from: 't' }, x: 'search_volume' }],
    };
    const { api, captured } = capturingPlotApi();
    buildPlotSpec(plot, {
      api,
      resolveSelection: () => undefined,
      resolveVariable: () => {
        throw new Error('should not resolve a non-ref channel');
      },
      geometry: {},
    });
    expect(captured().x).toBe('search_volume');
  });
});

// ── Cross-reference validation (compile errors + the raw-SQL boundary) ────────

/**
 * A minimal-but-valid dashboard with a variable, a structured data-table, a
 * vgplot widget, and a raw-template KPI — the four surfaces variable-ref
 * validation covers. Tests deep-clone it, mutate one corner, and compile.
 */
function baseSpec(): Record<string, unknown> {
  return {
    data: { tables: { t: { type: 'sql', query: 'SELECT 1 AS phrase' } } },
    topology: {
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
      page: { type: 'compose', as: 'crossfilter', include: ['filters.where'] },
      answer_field: { type: 'variable', default: 'phrase' },
    },
    filters: { fields: [] },
    widgets: {
      d: {
        renderer: 'data-table',
        title: 'D',
        filter_by: 'page',
        query: {
          type: 'select',
          from: 't',
          select: { col: '$answer_field' },
        },
        columns: [{ accessor_key: 'col', header: 'Col' }],
        bridge_columns: {},
      },
    },
    layout: { columns: 1, rows: [{ widgets: [{ ref: 'd', col_span: 1 }] }] },
  };
}

function compileMutated(
  mutate: (spec: any) => void,
): ReturnType<typeof compileSpec> {
  const spec = structuredClone(baseSpec());
  mutate(spec);
  return compileSpec(stringifyYaml(spec));
}

function expectError(
  result: ReturnType<typeof compileSpec>,
  match: (error: string) => boolean,
): void {
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('expected a compile failure');
  }
  expect(result.errors.some(match)).toBe(true);
}

describe('variable-ref cross-reference validation', () => {
  test('a structured $name column bound to a declared variable compiles', () => {
    const result = compileMutated(() => {});
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('an unknown structured $name ref is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.select.col = '$nope';
    });
    expectError(
      result,
      (error) =>
        error.includes('$nope') && error.includes('not a declared variable'),
    );
  });

  test('a structured $name ref naming a selection is a precise compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.select.col = '$page';
    });
    expectError(
      result,
      (error) =>
        error.includes('$page') &&
        error.includes('is a topology selection, not a variable'),
    );
  });

  test('a raw-template statement cannot bind a variable (boundary pinned)', () => {
    const result = compileMutated((spec) => {
      spec.widgets.k = {
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        filter_by: 'page',
        query: {
          type: 'sql',
          statement:
            'SELECT count(*) FILTER ($answer_field) AS value FROM t WHERE {{where}}',
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'k', col_span: 1 }] });
    });
    expectError(
      result,
      (error) =>
        error.includes('$answer_field') &&
        error.includes('cannot bind a variable'),
    );
  });

  test('a raw $-token that is not a declared variable is left alone', () => {
    const result = compileMutated((spec) => {
      // `$1` is not a declared variable, so the raw-SQL scan ignores it.
      spec.widgets.k = {
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        query: {
          type: 'sql',
          statement: "SELECT count(*) FILTER (phrase = '$1') AS value FROM t",
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'k', col_span: 1 }] });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('a vgplot $name channel bound to a declared variable compiles', () => {
    const result = compileMutated((spec) => {
      spec.widgets.p = {
        renderer: 'vgplot',
        label: 'P',
        plot: {
          marks: [
            { mark: 'rectY', data: { from: 't' }, fill: '$answer_field' },
          ],
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'p', col_span: 1 }] });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('a vgplot $name inside a bin column is an unsupported-position error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.p = {
        renderer: 'vgplot',
        label: 'P',
        plot: {
          marks: [
            { mark: 'rectY', data: { from: 't' }, x: { bin: '$answer_field' } },
          ],
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'p', col_span: 1 }] });
    });
    expectError(
      result,
      (error) =>
        error.includes('bin/date_bin/aggregate') &&
        error.includes('not supported'),
    );
  });

  // ── kpi-card / selection-table now take either query form ──────────────────

  test('a structured kpi-card $name column bound to a declared variable compiles', () => {
    const result = compileMutated((spec) => {
      spec.widgets.k = {
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        filter_by: 'page',
        query: {
          type: 'select',
          from: 't',
          select: { value: '$answer_field' },
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'k', col_span: 1 }] });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('a structured selection-table $name column bound to a declared variable compiles', () => {
    const result = compileMutated((spec) => {
      spec.widgets.s = {
        renderer: 'selection-table',
        title: 'S',
        metric_label: 'M',
        filter_by: 'page',
        query: {
          type: 'select',
          from: 't',
          select: { key: '$answer_field', metric: 'count(*)' },
        },
        publish: {
          spec_id: 'sel:s',
          label: 'S',
          columns: ['key'],
          fields: ['phrase'],
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 's', col_span: 1 }] });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('an unknown structured $name ref on a kpi-card is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.k = {
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        filter_by: 'page',
        query: { type: 'select', from: 't', select: { value: '$nope' } },
      };
      spec.layout.rows.push({ widgets: [{ ref: 'k', col_span: 1 }] });
    });
    expectError(
      result,
      (error) =>
        error.includes('$nope') && error.includes('not a declared variable'),
    );
  });

  test('a raw selection-table statement still rejects a variable-binding token', () => {
    const result = compileMutated((spec) => {
      spec.widgets.s = {
        renderer: 'selection-table',
        title: 'S',
        metric_label: 'M',
        filter_by: 'page',
        query: {
          type: 'sql',
          statement:
            'SELECT phrase AS key, count(*) FILTER ($answer_field) AS metric FROM t WHERE {{where}}',
        },
        publish: {
          spec_id: 'sel:s',
          label: 'S',
          columns: ['key'],
          fields: ['phrase'],
        },
      };
      spec.layout.rows.push({ widgets: [{ ref: 's', col_span: 1 }] });
    });
    expectError(
      result,
      (error) =>
        error.includes('$answer_field') &&
        error.includes('cannot bind a variable'),
    );
  });
});

// ── Schema accepts BOTH query forms on kpi-card and selection-table ───────────

describe('kpi-card / selection-table query-form schema acceptance', () => {
  const rawQuery = { type: 'sql', statement: 'SELECT 1 AS value' };
  const structuredQuery = {
    type: 'select',
    from: 't',
    select: { value: 'search_volume' },
  };

  test('kpi-card accepts a raw-template query', () => {
    expect(
      kpiCardWidgetSchema.safeParse({
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        query: rawQuery,
      }).success,
    ).toBe(true);
  });

  test('kpi-card accepts a structured query', () => {
    expect(
      kpiCardWidgetSchema.safeParse({
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        query: structuredQuery,
      }).success,
    ).toBe(true);
  });

  const selectionTableBase = {
    renderer: 'selection-table',
    title: 'S',
    metric_label: 'M',
    filter_by: 'page',
    publish: {
      spec_id: 'sel:s',
      label: 'S',
      columns: ['key'],
      fields: ['key'],
    },
  };

  test('selection-table accepts a raw-template query', () => {
    expect(
      selectionTableWidgetSchema.safeParse({
        ...selectionTableBase,
        query: rawQuery,
      }).success,
    ).toBe(true);
  });

  test('selection-table accepts a structured query', () => {
    expect(
      selectionTableWidgetSchema.safeParse({
        ...selectionTableBase,
        query: { type: 'select', from: 't', select: { key: 'domain' } },
      }).success,
    ).toBe(true);
  });
});
