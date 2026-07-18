import { describe, expect, test } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { Param } from '@uwdata/mosaic-core';
import { collectParams, isColumnParam } from '@uwdata/mosaic-sql';
import {
  compileStructuredQuery,
  parseVariableRef,
  scanFragmentTokens,
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

  test('compileStructuredQuery binds a structured $name column for the kpi (ValuesInputs) shape', () => {
    const param = Param.value('title');
    const compiled = compileStructuredQuery<ValuesInputs>(
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

// ── Fragment token scanner (the single grammar source) ───────────────────────

/** The tokens a scan finds, rendered as `$name` / `:name` for readable asserts. */
function scannedTokens(fragment: string, declared: Set<string>): Array<string> {
  return scanFragmentTokens(fragment, declared).map(
    (token) => `${token.kind === 'column' ? '$' : ':'}${token.name}`,
  );
}

describe('scanFragmentTokens', () => {
  const declared = new Set(['min', 'metric', 'x', 'int', 'tag']);

  test('finds $name (column) and :name (value) for declared names', () => {
    expect(scannedTokens('count(DISTINCT $metric)', declared)).toEqual([
      '$metric',
    ]);
    expect(scannedTokens('search_volume >= :min', declared)).toEqual([':min']);
    expect(scannedTokens('sum($x) FILTER (rank > :min)', declared)).toEqual([
      '$x',
      ':min',
    ]);
    // A `:name` at index 0 (no char before) still binds.
    expect(scannedTokens(':min > 0', declared)).toEqual([':min']);
  });

  test('records the token span so the fragment can be split on it', () => {
    // `count(DISTINCT $metric)` — `$metric` starts at index 15, spans 7 chars.
    expect(scanFragmentTokens('count(DISTINCT $metric)', declared)).toEqual([
      { kind: 'column', name: 'metric', start: 15, end: 22 },
    ]);
  });

  test('immunizes a ::cast beside a declared name', () => {
    // `::int` is a cast, not a `:int` value token (char before the sigil is `:`).
    expect(scannedTokens('rank::int >= :min', declared)).toEqual([':min']);
  });

  test('immunizes $$ dollar-quotes and word-adjacent sigils', () => {
    expect(scannedTokens('$$tag$$', declared)).toEqual([]);
    expect(scannedTokens('a$x', declared)).toEqual([]);
    // A positional `$1` never starts an identifier.
    expect(scannedTokens('id = $1', declared)).toEqual([]);
  });

  test('leaves tokens whose name is not declared alone', () => {
    // `:minute` captures the whole word (greedy) — `minute` is not declared.
    expect(scannedTokens(':minute', declared)).toEqual([]);
    expect(scannedTokens('answer > :threshold', declared)).toEqual([]);
    expect(scannedTokens('$unknown', declared)).toEqual([]);
  });

  test('an empty declared set finds nothing', () => {
    expect(scannedTokens('count(DISTINCT $metric) >= :min', new Set())).toEqual(
      [],
    );
  });
});

// ── Fragment-level variable binding (codegen) ─────────────────────────────────

describe('compileStructuredQuery fragment binding', () => {
  test('a $name column token renders a quoted identifier tracking param.update', () => {
    const param = Param.value('phrase');
    const compiled = compileStructuredQuery<RowsInputs>(
      { type: 'select', from: 't', select: { n: 'count(DISTINCT $x)' } },
      () => param,
      new Set(['x']),
    );
    expect(compiled.variables).toEqual(['x']);
    expect(String(run(compiled.source))).toContain('count(DISTINCT "phrase")');
    // Live: renaming the Param re-quotes the identifier on the next build.
    param.update('domain');
    expect(String(run(compiled.source))).toContain('count(DISTINCT "domain")');
  });

  test('a :name value token renders an escaped literal tracking param.update', () => {
    const param = Param.value<number | string>(5);
    const compiled = compileStructuredQuery<RowsInputs>(
      {
        type: 'select',
        from: 't',
        select: { v: 'search_volume' },
        where: ['search_volume >= :min'],
      },
      () => param,
      new Set(['min']),
    );
    expect(compiled.variables).toEqual(['min']);
    expect(String(run(compiled.source))).toContain('search_volume >= 5');
    // A string value is single-quote-escaped (the injection-safety pin).
    param.update("O'Brien");
    expect(String(run(compiled.source))).toContain(
      "search_volume >= 'O''Brien'",
    );
  });

  test('a $name group_by token compiles and re-groups on update (crash regression)', () => {
    // A bare `$name` group_by entry used to throw at query-build time because no
    // resolver was threaded into the group_by `columnExpr` call.
    const param = Param.value('domain');
    const compiled = compileStructuredQuery<RowsInputs>(
      {
        type: 'select',
        from: 't',
        select: { k: '$k', n: 'count(*)' },
        group_by: ['$k'],
      },
      () => param,
      new Set(['k']),
    );
    expect(compiled.variables).toEqual(['k']);
    expect(String(run(compiled.source))).toContain('GROUP BY "domain"');
    param.update('phrase');
    expect(String(run(compiled.source))).toContain('GROUP BY "phrase"');
  });

  test('a ::cast beside a declared :name does not misfire', () => {
    const param = Param.value(10);
    const compiled = compileStructuredQuery<RowsInputs>(
      {
        type: 'select',
        from: 't',
        select: { v: 'volume' },
        where: ['rank::int >= :min'],
      },
      () => param,
      new Set(['min', 'int']),
    );
    // Only `:min` binds — `::int` stays a verbatim cast, and `int` is not bound.
    expect(compiled.variables).toEqual(['min']);
    const sql = String(run(compiled.source));
    expect(sql).toContain('rank::int >=');
    expect(sql).toContain('>= 10');
  });

  test('where and having fragments both bind value tokens', () => {
    const lo = Param.value(1);
    const hi = Param.value(9);
    const resolve = (name: string): Param<number> => (name === 'lo' ? lo : hi);
    const compiled = compileStructuredQuery<RowsInputs>(
      {
        type: 'select',
        from: 't',
        select: { g: 'domain', n: 'count(*)' },
        group_by: ['domain'],
        where: ['search_volume > :lo'],
        having: ['count(*) < :hi'],
      },
      resolve,
      new Set(['lo', 'hi']),
    );
    expect(compiled.variables).toEqual(['lo', 'hi']);
    const sql = String(run(compiled.source));
    expect(sql).toContain('search_volume > 1');
    expect(sql).toContain('count(*) < 9');
  });

  test('the variable set unions every bindable position, deduplicated in order', () => {
    const compiled = compileStructuredQuery<RowsInputs>(
      {
        type: 'select',
        from: 't',
        select: { one: '$a', two: 'coalesce($b, :c)', three: 'plain' },
        group_by: ['$a', '$d'],
        where: [':c > 0'],
        having: ['count(*) > :d'],
      },
      (name) => Param.value(name),
      new Set(['a', 'b', 'c', 'd']),
    );
    // select ($a, then $b/:c), group_by ($a dup, $d), where (:c dup), having
    // (:d dup) → the stable, de-duplicated union.
    expect(compiled.variables).toEqual(['a', 'b', 'c', 'd']);
  });

  test('a no-token fragment compiles byte-identically to a no-binding compile', () => {
    const spec: StructuredQuery = {
      type: 'select',
      from: 't',
      select: { m: 'max(search_volume)' },
      where: ['search_volume > 0'],
    };
    // A declared set with no matching token must not perturb the output.
    const bound = compileStructuredQuery<RowsInputs>(
      spec,
      () => Param.value('unused'),
      new Set(['answer_field']),
    );
    const plain = compileStructuredQuery<RowsInputs>(spec);
    expect(bound.variables).toEqual([]);
    expect(String(run(bound.source))).toBe(String(run(plain.source)));
    // The fragment is embedded verbatim (no identifier quoting).
    expect(String(run(bound.source))).toContain('max(search_volume)');
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

// ── Cross-reference validation (compile errors) ───────────────────────────────

/**
 * A minimal-but-valid dashboard with a variable and a structured data-table.
 * Tests deep-clone it, mutate one corner (adding a structured KPI, a vgplot
 * widget, …), and compile to exercise the variable-ref surfaces.
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

  test('an unknown query type fails schema parse', () => {
    const result = compileMutated((spec) => {
      // The raw-template (`type: sql`) widget-query form is gone: any query
      // whose `type` is not the structured `select` is rejected at schema parse.
      spec.widgets.d.query = {
        type: 'sql',
        statement: 'SELECT count(*) AS value FROM t WHERE {{where}}',
      };
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected a compile failure');
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

  // ── kpi-card / selection-table take the structured query form ──────────────

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

  // ── Fragment-level refs across the new binding positions ───────────────────

  test('a fragment $name column token bound to a declared variable compiles', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.select.col = 'count(DISTINCT $answer_field)';
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('a fragment :name value token bound to a declared variable compiles', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.where = ['search_volume >= :answer_field'];
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('a select fragment token naming a selection is a precise compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.select.col = 'coalesce(phrase, :page)';
    });
    expectError(
      result,
      (error) =>
        error.includes(':page') &&
        error.includes('is a topology selection, not a variable'),
    );
  });

  test('a group_by fragment token naming a selection is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.group_by = ['date_trunc($page)'];
    });
    expectError(
      result,
      (error) =>
        error.includes('$page') &&
        error.includes('is a topology selection, not a variable'),
    );
  });

  test('an unknown $name group_by ref is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.group_by = ['$nope'];
    });
    expectError(
      result,
      (error) =>
        error.includes('$nope') && error.includes('not a declared variable'),
    );
  });

  test('a where fragment token naming a selection is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.where = ['search_volume > :page'];
    });
    expectError(
      result,
      (error) =>
        error.includes(':page') &&
        error.includes('is a topology selection, not a variable'),
    );
  });

  test('a having fragment token naming a selection is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.having = ['count(*) > $page'];
    });
    expectError(
      result,
      (error) =>
        error.includes('$page') &&
        error.includes('is a topology selection, not a variable'),
    );
  });

  test('a $name in from naming a declared variable is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.d.query.from = '$answer_field';
    });
    expectError(
      result,
      (error) =>
        error.includes('$answer_field') &&
        error.includes('cannot switch the query table'),
    );
  });

  test('an undeclared :name token in a fragment is left as SQL (no error)', () => {
    // `threshold` is neither a variable nor a selection — the grammar leaves it
    // alone (it could be legitimate SQL), so the spec still compiles.
    const result = compileMutated((spec) => {
      spec.widgets.d.query.where = ['search_volume > :threshold'];
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });
});

// ── Schema accepts only the structured query form (kpi-card / selection-table) ─

describe('kpi-card / selection-table query-form schema acceptance', () => {
  const rawQuery = { type: 'sql', statement: 'SELECT 1 AS value' };
  const structuredQuery = {
    type: 'select',
    from: 't',
    select: { value: 'search_volume' },
  };

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

  test('kpi-card rejects a raw-template query', () => {
    expect(
      kpiCardWidgetSchema.safeParse({
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        query: rawQuery,
      }).success,
    ).toBe(false);
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

  test('selection-table accepts a structured query', () => {
    expect(
      selectionTableWidgetSchema.safeParse({
        ...selectionTableBase,
        query: { type: 'select', from: 't', select: { key: 'domain' } },
      }).success,
    ).toBe(true);
  });

  test('selection-table rejects a raw-template query', () => {
    expect(
      selectionTableWidgetSchema.safeParse({
        ...selectionTableBase,
        query: rawQuery,
      }).success,
    ).toBe(false);
  });
});
