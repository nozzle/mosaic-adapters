import { describe, expect, test } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { createTopology } from '@nozzleio/react-mosaic';
import {
  topologyDeclarationSchema,
  variableDefaultSchema,
  variableSelectWidgetSchema,
  widgetSchema,
} from '../src/spec/schema';
import {
  resolveVariable,
  toTopologyConfig,
  variableEntryNames,
} from '../src/spec/topology';
import { compileSpec } from '../src/spec/compile';
import type { TopologySpec } from '../src/spec/schema';

// ── variableDefaultSchema (the ParamValue value domain) ───────────────────────

describe('variableDefaultSchema', () => {
  test('accepts every scalar the ParamValue domain allows', () => {
    for (const value of ['all', 42, 3.14, true, false, null]) {
      expect(variableDefaultSchema.safeParse(value).success).toBe(true);
    }
  });

  test('accepts a flat array of scalars (including mixed and empty)', () => {
    expect(variableDefaultSchema.safeParse([]).success).toBe(true);
    expect(variableDefaultSchema.safeParse(['a', 'b']).success).toBe(true);
    expect(variableDefaultSchema.safeParse([1, 2, 3]).success).toBe(true);
    expect(variableDefaultSchema.safeParse(['a', 1, true, null]).success).toBe(
      true,
    );
  });

  test('rejects objects and nested arrays', () => {
    expect(variableDefaultSchema.safeParse({ a: 1 }).success).toBe(false);
    expect(variableDefaultSchema.safeParse([[1, 2]]).success).toBe(false);
    expect(variableDefaultSchema.safeParse([{ a: 1 }]).success).toBe(false);
  });
});

// ── variable declaration (in the topology declaration union) ──────────────────

describe('variable topology declaration', () => {
  test('accepts scalar, array, and null defaults with optional base fields', () => {
    expect(
      topologyDeclarationSchema.safeParse({ type: 'variable', default: 0.5 })
        .success,
    ).toBe(true);
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: ['a', 'b'],
        label: 'Modes',
        meta: { note: 'opaque' },
        reset: false,
      }).success,
    ).toBe(true);
    expect(
      topologyDeclarationSchema.safeParse({ type: 'variable', default: null })
        .success,
    ).toBe(true);
  });

  test('rejects a missing default', () => {
    expect(
      topologyDeclarationSchema.safeParse({ type: 'variable' }).success,
    ).toBe(false);
  });

  test('rejects a non-scalar (object) default', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: { not: 'scalar' },
      }).success,
    ).toBe(false);
  });

  test('rejects a nested-array default', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: [[1, 2]],
      }).success,
    ).toBe(false);
  });

  test('rejects an unknown key (strict)', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: 1,
        bogus: true,
      }).success,
    ).toBe(false);
  });
});

// ── variable persist key (app-only URL persistence) ──────────────────────────

describe('variable declaration persist key', () => {
  test('accepts a bare url persist (no param override)', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: 'title',
        persist: { type: 'url' },
      }).success,
    ).toBe(true);
  });

  test('accepts a url persist with an explicit param override', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: 'title',
        persist: { type: 'url', param: 'answer' },
      }).success,
    ).toBe(true);
  });

  test('rejects an unknown persist type (discriminated, strict)', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: 'title',
        persist: { type: 'local-storage' },
      }).success,
    ).toBe(false);
  });

  test('rejects an unknown persist key (strict)', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: 'title',
        persist: { type: 'url', prefix: 'v' },
      }).success,
    ).toBe(false);
  });

  test('rejects an empty / whitespace-only param override', () => {
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: 'title',
        persist: { type: 'url', param: '' },
      }).success,
    ).toBe(false);
    expect(
      topologyDeclarationSchema.safeParse({
        type: 'variable',
        default: 'title',
        persist: { type: 'url', param: ' v ' },
      }).success,
    ).toBe(false);
  });
});

// ── toTopologyConfig (spec "variable" → library "param") ──────────────────────

describe('toTopologyConfig variable mapping', () => {
  test('maps a variable to a library param, passing base fields through', () => {
    const topology: TopologySpec = {
      threshold: {
        type: 'variable',
        default: 0.5,
        label: 'Threshold',
        meta: { unit: 'ratio' },
        reset: false,
      },
    };
    expect(toTopologyConfig(topology)).toEqual({
      threshold: {
        type: 'param',
        default: 0.5,
        label: 'Threshold',
        meta: { unit: 'ratio' },
        reset: false,
      },
    });
  });

  test('strips the app-only persist key from the library param declaration', () => {
    const topology: TopologySpec = {
      answer_field: {
        type: 'variable',
        default: 'title',
        label: 'Answer field',
        persist: { type: 'url', param: 'answer' },
      },
    };
    const config = toTopologyConfig(topology);
    const mapped = config.answer_field;
    expect(mapped).toEqual({
      type: 'param',
      default: 'title',
      label: 'Answer field',
    });
    expect(mapped !== undefined && 'persist' in mapped).toBe(false);
  });

  test('maps a bare variable (default only) with no extra keys', () => {
    const topology: TopologySpec = {
      mode: { type: 'variable', default: ['a', 'b'] },
    };
    expect(toTopologyConfig(topology)).toEqual({
      mode: { type: 'param', default: ['a', 'b'] },
    });
  });

  test('leaves sibling non-variable declarations untouched', () => {
    const topology: TopologySpec = {
      brush: { type: 'single' },
      mode: { type: 'variable', default: 'all' },
    };
    expect(toTopologyConfig(topology)).toEqual({
      brush: { type: 'single' },
      mode: { type: 'param', default: 'all' },
    });
  });
});

describe('variableEntryNames', () => {
  test('lists only the declared variable entries', () => {
    const topology: TopologySpec = {
      brush: { type: 'single' },
      mode: { type: 'variable', default: 'all' },
      threshold: { type: 'variable', default: 0.5 },
    };
    expect(variableEntryNames(topology).sort()).toEqual(['mode', 'threshold']);
  });
});

// ── resolveVariable (topology helper) ─────────────────────────────────────────

describe('resolveVariable', () => {
  function topologyWithVariable() {
    return createTopology(
      toTopologyConfig({
        brush: { type: 'single' },
        mode: { type: 'variable', default: 'all' },
      }),
    );
  }

  test('resolves a declared variable to its Param holding the default', () => {
    const topology = topologyWithVariable();
    const param = resolveVariable(topology, 'mode');
    expect(param).toBeDefined();
    expect(param?.value).toBe('all');
    topology.destroy();
  });

  test('undefined ref resolves to undefined', () => {
    const topology = topologyWithVariable();
    expect(resolveVariable(topology, undefined)).toBeUndefined();
    topology.destroy();
  });

  test('throws usefully on a selection ref', () => {
    const topology = topologyWithVariable();
    expect(() => resolveVariable(topology, 'brush')).toThrow(/not a param/);
    topology.destroy();
  });

  test('throws usefully on an unknown ref', () => {
    const topology = topologyWithVariable();
    expect(() => resolveVariable(topology, 'nope')).toThrow(/undeclared/);
    topology.destroy();
  });
});

// ── variable-select widget schema ─────────────────────────────────────────────

describe('variableSelectWidgetSchema', () => {
  const base = {
    renderer: 'variable-select',
    label: 'Minimum volume',
    variable: 'min_volume',
    options: [{ value: 0, label: 'Any' }, { value: 100 }],
  };

  test('accepts a valid widget (scalar values, optional per-option label)', () => {
    expect(variableSelectWidgetSchema.safeParse(base).success).toBe(true);
  });

  test('accepts every scalar the option value domain allows', () => {
    for (const value of ['a', 42, 3.14, true, false, null]) {
      expect(
        variableSelectWidgetSchema.safeParse({ ...base, options: [{ value }] })
          .success,
      ).toBe(true);
    }
  });

  test('routes through the widget discriminated union on renderer', () => {
    expect(widgetSchema.safeParse(base).success).toBe(true);
  });

  test('rejects a missing variable', () => {
    expect(
      variableSelectWidgetSchema.safeParse({
        renderer: 'variable-select',
        label: 'Minimum volume',
        options: [{ value: 0 }],
      }).success,
    ).toBe(false);
  });

  test('rejects empty options', () => {
    expect(
      variableSelectWidgetSchema.safeParse({ ...base, options: [] }).success,
    ).toBe(false);
  });

  test('rejects a non-scalar (array) option value', () => {
    expect(
      variableSelectWidgetSchema.safeParse({
        ...base,
        options: [{ value: [1, 2] }],
      }).success,
    ).toBe(false);
  });

  test('rejects a non-scalar (object) option value', () => {
    expect(
      variableSelectWidgetSchema.safeParse({
        ...base,
        options: [{ value: { a: 1 } }],
      }).success,
    ).toBe(false);
  });

  test('rejects an unknown key (strict)', () => {
    expect(
      variableSelectWidgetSchema.safeParse({ ...base, bogus: true }).success,
    ).toBe(false);
  });
});

// ── Compile plumbing (a declared-unused variable compiles) ────────────────────

/**
 * A minimal-but-valid dashboard spec object. One filter-set, one KPI card. Tests
 * deep-clone it, mutate one corner, stringify to YAML, and compile.
 */
function baseSpec(): Record<string, unknown> {
  return {
    data: {
      tables: {
        t: { type: 'sql', query: 'SELECT 1 AS phrase' },
      },
    },
    topology: {
      filters: { type: 'filter-set', targets: { where: 'crossfilter' } },
      page: { type: 'compose', as: 'crossfilter', include: ['filters.where'] },
    },
    filters: { fields: [] },
    widgets: {
      k: {
        renderer: 'kpi-card',
        label: 'K',
        format: 'number',
        filter_by: 'page',
        query: {
          type: 'sql',
          statement: 'SELECT count(*) AS value FROM t WHERE {{where}}',
        },
      },
    },
    layout: { columns: 1, rows: [{ widgets: [{ ref: 'k', col_span: 1 }] }] },
  };
}

function compileMutated(
  mutate: (spec: any) => void,
): ReturnType<typeof compileSpec> {
  const spec = structuredClone(baseSpec());
  mutate(spec);
  return compileSpec(stringifyYaml(spec));
}

describe('variable compile plumbing', () => {
  test('the base spec compiles cleanly (sanity)', () => {
    expect(compileMutated(() => {}).ok).toBe(true);
  });

  test('a declared-but-unused variable compiles cleanly', () => {
    const result = compileMutated((spec) => {
      spec.topology.threshold = {
        type: 'variable',
        default: 0.5,
        label: 'Threshold',
      };
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
    // The variable maps to a library param on the compiled config.
    expect(result.compiled.topologyConfig.threshold).toEqual({
      type: 'param',
      default: 0.5,
      label: 'Threshold',
    });
  });

  test('referencing a variable where a selection is expected is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.topology.threshold = { type: 'variable', default: 0.5 };
      spec.widgets.k.filter_by = 'threshold';
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(
      result.errors.some(
        (error) =>
          error.includes("'threshold'") &&
          error.includes('is a variable, not a topology selection ref'),
      ),
    ).toBe(true);
  });

  test('a variable + a variable-select widget driving it compiles', () => {
    const result = compileMutated((spec) => {
      spec.topology.min_volume = {
        type: 'variable',
        default: 0,
        label: 'Minimum volume',
      };
      spec.widgets.v = {
        renderer: 'variable-select',
        label: 'Minimum volume',
        variable: 'min_volume',
        options: [
          { value: 0, label: 'Any' },
          { value: 100, label: '100+' },
        ],
      };
      spec.layout.rows.push({ widgets: [{ ref: 'v', col_span: 1 }] });
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.errors.join('; '));
    }
  });

  test('a variable-select naming an unknown variable is a compile error', () => {
    const result = compileMutated((spec) => {
      spec.widgets.v = {
        renderer: 'variable-select',
        label: 'X',
        variable: 'nope',
        options: [{ value: 0 }],
      };
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(
      result.errors.some(
        (error) =>
          error.includes("'nope'") &&
          error.includes('is not a declared variable'),
      ),
    ).toBe(true);
  });

  test('a variable-select naming a selection (not a variable) is a compile error', () => {
    const result = compileMutated((spec) => {
      // `page` is a compose SELECTION declared in the base spec's topology.
      spec.widgets.v = {
        renderer: 'variable-select',
        label: 'X',
        variable: 'page',
        options: [{ value: 0 }],
      };
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(
      result.errors.some(
        (error) =>
          error.includes("'page'") &&
          error.includes('is a topology selection, not a variable'),
      ),
    ).toBe(true);
  });
});
