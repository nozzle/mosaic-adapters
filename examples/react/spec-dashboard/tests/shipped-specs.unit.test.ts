/**
 * Shipped-spec compile guard. The e2e suite exercises the served specs end to
 * end, but that is a slow, browser-bound signal. This unit test parses + compiles
 * every spec the manifest ships (`public/spec/*.yaml`) through the real
 * {@link compileSpec} pipeline, so schema drift or a stale cross-reference in a
 * SHIPPED spec fails fast here — not only in Playwright.
 *
 * The list is derived from the manifest, so a newly-added spec is covered the
 * moment it is registered; no per-spec test to keep in sync.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { compileSpec, specManifestSchema } from '../src/spec/compile';
import type { StructuredQuery } from '../src/spec/schema';

/** Absolute path to a file served from the example's `public/` root. */
function publicPath(servedUrl: string): string {
  return fileURLToPath(new URL(`../public${servedUrl}`, import.meta.url));
}

function readText(servedUrl: string): string {
  return readFileSync(publicPath(servedUrl), 'utf8');
}

const manifest = specManifestSchema.parse(
  JSON.parse(readText('/spec/manifest.json')),
);

describe('shipped specs compile', () => {
  for (const entry of manifest.specs) {
    test(`'${entry.id}' (${entry.url}) compiles without errors`, () => {
      const result = compileSpec(readText(entry.url));
      // Surface the real errors in the failure message rather than a bare `false`.
      if (!result.ok) {
        throw new Error(
          `spec '${entry.id}' failed to compile:\n  ${result.errors.join('\n  ')}`,
        );
      }
      expect(result.ok).toBe(true);
    });
  }
});

// Pin the questions-spec migration: the KPI cards and selection tables were moved
// from raw `type: sql` templates to structured `type: select` queries, and the
// rendered data must stay identical (proven byte-for-byte by e2e). Guard here that
// the shipped spec keeps the structured form so an accidental revert is caught in
// unit tests.
describe('questions spec query forms', () => {
  const result = compileSpec(readText('/spec/questions.yaml'));
  if (!result.ok) {
    throw new Error(
      `questions spec failed to compile: ${result.errors.join('; ')}`,
    );
  }
  const { widgets } = result.compiled.spec;

  const structuredIds = [
    'kpi_phrases',
    'kpi_questions',
    'kpi_distinct',
    'kpi_phrases_all',
    'kpi_phrases_no_domain',
    'by_phrase',
    'by_domain',
    'by_device',
    'by_bucket',
    'detail',
  ];

  for (const id of structuredIds) {
    test(`widget '${id}' uses a structured (type: select) query`, () => {
      const widget = widgets[id];
      expect(widget).toBeDefined();
      // Only query-bearing renderers reach here. The structured form is now the
      // ONLY widget-query shape the schema admits (a revert to a raw statement
      // would fail to parse in `compileSpec`), but read the runtime `type` back
      // anyway so the shipped spec is pinned to it.
      expect(widget !== undefined && 'query' in widget).toBe(true);
      const query = (widget as { query?: { type?: string } }).query;
      expect(query?.type).toBe('select');
    });
  }

  test('by_domain keeps its static WHERE fragment plus the :min_volume value token', () => {
    const widget = widgets['by_domain'];
    expect(widget !== undefined && 'query' in widget).toBe(true);
    const query = (widget as { query: StructuredQuery }).query;
    // The static predicate is preserved and the `:min_volume` VALUE placeholder
    // is ANDed in as a second fragment.
    expect(query.where).toEqual([
      'domain IS NOT NULL',
      'search_volume >= :min_volume',
    ]);
    expect(query.group_by).toEqual(['domain']);
  });
});

// Pin the two live fragment-token usages the shipped questions spec exercises:
// a `:name` VALUE placeholder (`min_volume`) and a `$name` COLUMN token
// (`count_field`), each declared as a persisted/unpersisted `variable` and driven
// by a `variable-select` control. A regression that dropped either the variable,
// its control, or the binding would render the tokens inert — caught here without
// waiting on Playwright.
describe('questions spec fragment-token variable usages', () => {
  const result = compileSpec(readText('/spec/questions.yaml'));
  if (!result.ok) {
    throw new Error(
      `questions spec failed to compile: ${result.errors.join('; ')}`,
    );
  }
  const { spec } = result.compiled;
  const { widgets, topology } = spec;

  test('declares the count_field variable (unpersisted) and the min_volume variable (url-persisted)', () => {
    const countField = topology['count_field'];
    expect(countField).toEqual({
      type: 'variable',
      default: 'device',
      label: 'Count dimension',
    });

    const minVolume = topology['min_volume'];
    expect(minVolume !== undefined && minVolume.type === 'variable').toBe(true);
    expect((minVolume as { default?: unknown }).default).toBe(0);
    expect((minVolume as { persist?: unknown }).persist).toEqual({
      type: 'url',
    });
  });

  test('kpi_distinct binds count_field as a $name COLUMN token in count(DISTINCT ...)', () => {
    const widget = widgets['kpi_distinct'];
    expect(widget !== undefined && 'query' in widget).toBe(true);
    const query = (widget as { query: StructuredQuery }).query;
    expect(query.select['value']).toBe('count(DISTINCT $count_field)');
  });

  test('the count_field_select control drives the count_field variable', () => {
    const widget = widgets['count_field_select'];
    expect(widget?.renderer).toBe('variable-select');
    expect((widget as { variable?: string }).variable).toBe('count_field');
    const values = (
      widget as { options?: Array<{ value: unknown }> }
    ).options?.map((option) => option.value);
    expect(values).toEqual(['device', 'requested', 'phrase', 'domain']);
  });

  test('the min_volume_select control drives the min_volume variable with numeric thresholds', () => {
    const widget = widgets['min_volume_select'];
    expect(widget?.renderer).toBe('variable-select');
    expect((widget as { variable?: string }).variable).toBe('min_volume');
    const values = (
      widget as { options?: Array<{ value: unknown }> }
    ).options?.map((option) => option.value);
    expect(values).toEqual([0, 10000, 50000]);
  });
});
