/**
 * The `aggregate-threshold` behavior is the library's
 * `aggregateThresholdFilterKind` instantiated from spec config. Pin the
 * clauses the shipped questions spec's threshold kinds publish: the HAVING
 * comparison on the card's own target and the membership subquery (grouped by
 * the spec's own column) on its `members:` target.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { emitFilterSpec } from '@nozzleio/react-mosaic';
import type { FilterSpec } from '@nozzleio/react-mosaic';
import { describe, expect, test } from 'vitest';

import { compileSpec } from '../src/spec/compile';
import { aggregateThresholdBehavior, buildKindRegistry } from '../src/spec/kinds';

function questionsSpec() {
  const text = readFileSync(
    fileURLToPath(new URL('../public/spec/questions.yaml', import.meta.url)),
    'utf8',
  );
  const result = compileSpec(text);
  if (!result.ok) {
    throw new Error(`questions spec failed to compile: ${result.errors.join('; ')}`);
  }
  return result.compiled.spec;
}

describe('aggregate-threshold behavior', () => {
  const kinds = buildKindRegistry(questionsSpec());

  test('emits HAVING and membership clauses grouped by the spec column', () => {
    const spec: FilterSpec = {
      id: 'metric:phrase',
      column: 'phrase',
      kind: 'metric_threshold',
      operator: 'gt',
      value: 1000,
    };
    const emissions = emitFilterSpec(spec, { kinds });

    expect(emissions.map((emission) => emission.target)).toEqual([
      'having:phrase',
      'members:phrase',
    ]);
    expect(String(emissions[0]?.predicate)).toBe('(max(search_volume) > 1000)');
    expect(emissions[0]?.fields).toEqual([]);
    expect(String(emissions[1]?.predicate)).toBe(
      '("phrase" IN (SELECT "phrase" FROM "questions_enriched" GROUP BY "phrase" HAVING (max(search_volume) > 1000)))',
    );
  });

  test('advertises only the configured operators and formats chips with a glyph', () => {
    const kind = kinds.metric_threshold_domain;
    expect(kind?.operators?.map((operator) => operator.id)).toEqual(['gt', 'lt']);
    expect(
      kind?.formatValue?.({
        id: 'metric:domain',
        column: 'domain',
        kind: 'metric_threshold_domain',
        operator: 'lt',
        value: 3,
      }),
    ).toBe('< 3');
  });

  test('a spec with an operator outside the config is inactive', () => {
    const kind = aggregateThresholdBehavior({
      table: 'questions_enriched',
      aggregate: 'count(*)',
      having_target: 'having:domain',
      members_target: 'members:domain',
      operators: ['gt', 'lt'],
    });
    const spec: FilterSpec = {
      id: 'metric:domain',
      column: 'domain',
      kind: 'threshold',
      operator: 'gte',
      value: 3,
    };
    expect(emitFilterSpec(spec, { kinds: { threshold: kind } })).toEqual([]);
  });
});
