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
    'kpi_days',
    'kpi_devices',
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
      // Only query-bearing renderers reach here; narrow to the query-carrying set.
      expect(
        widget !== undefined &&
          'query' in widget &&
          widget.query.type === 'select',
      ).toBe(true);
    });
  }

  test('by_domain keeps its static WHERE fragment', () => {
    const widget = widgets['by_domain'];
    expect(widget !== undefined && 'query' in widget).toBe(true);
    const query = (widget as { query: StructuredQuery }).query;
    expect(query.where).toEqual(['domain IS NOT NULL']);
    expect(query.group_by).toEqual(['domain']);
  });
});
