/**
 * SERP Appearances widget filter for the PAA Questions summary table.
 *
 * One logical filter producing two predicates from a single (operator, value)
 * input, gated by an explicit "apply" checkbox:
 *
 * 1. HAVING `count(*) >/< N` — published into the `having` Selection and
 *    routed to the question table's own grouped query via `havingBy`.
 * 2. Membership subquery
 *    `related_phrase.phrase IN (SELECT related_phrase.phrase FROM nozzle_paa
 *      WHERE <question context> GROUP BY 1 HAVING count(*) >/< N)`
 *    — published into the `members` Selection that sibling widgets, the
 *    detail table, the facet inputs, and the KPIs include in their contexts.
 *
 * The subquery embeds the question table's own filter context (top-bar
 * inputs + detail filters + the OTHER summary selections) so the sibling
 * subset matches exactly what the question widget displays. It is rebuilt
 * whenever that context changes; republish is skipped when the predicate is
 * unchanged, so the rebuild converges.
 */
import { useCallback, useEffect, useState } from 'react';
import * as mSql from '@uwdata/mosaic-sql';
import {
  buildSubqueryPredicate,
  createClearClause,
  createSubqueryClause,
  createValueClause,
} from '@nozzleio/mosaic-tanstack-react-table/helpers';
import type { Selection, SelectionClause } from '@uwdata/mosaic-core';
import type { ExprNode } from '@uwdata/mosaic-sql';

const QUESTION_COLUMN = 'related_phrase.phrase';

// Stable clause identities (module scope: survive remounts/enlarge swaps).
const SERP_HAVING_SOURCE = {
  id: 'paa-serp-having',
  debugName: 'SERP Appears (HAVING)',
};
const SERP_MEMBERS_SOURCE = {
  id: 'paa-serp-members',
  column: 'serp_appearances',
  debugName: 'SERP Appears',
};

export type SerpComparison = 'gt' | 'lt';

export interface SerpAppearancesFilterState {
  applied: boolean;
  setApplied: (next: boolean) => void;
  comparison: SerpComparison;
  setComparison: (next: SerpComparison) => void;
  value: number | null;
  setValue: (next: number | null) => void;
}

function questionExpr() {
  return mSql.sql`"related_phrase"."phrase"`;
}

function normalizeContextPredicate(
  predicate: ReturnType<Selection['predicate']>,
): ExprNode | null {
  if (!predicate) {
    return null;
  }

  if (!Array.isArray(predicate)) {
    return predicate as ExprNode;
  }

  if (predicate.length === 0) {
    return null;
  }

  const [first, ...rest] = predicate;
  if (rest.length === 0) {
    return (first ?? null) as ExprNode | null;
  }

  return mSql.and(...predicate);
}

function updateClauseIfChanged(
  selection: Selection,
  clause: SelectionClause,
): void {
  const current = selection.clauses.find(
    (existing) => existing.source === clause.source,
  );

  if (
    current?.predicate != null &&
    clause.predicate != null &&
    String(current.predicate) === String(clause.predicate)
  ) {
    return;
  }

  selection.update(clause);
}

export function useSerpAppearancesFilter({
  tableName,
  having,
  members,
  context,
  enabled,
}: {
  tableName: string;
  /** Selection routed to the question table's HAVING clause. */
  having: Selection;
  /** Selection carrying the membership subquery for sibling widgets. */
  members: Selection;
  /** The question table's filter context (inputs + detail + other summaries). */
  context: Selection;
  enabled: boolean;
}): SerpAppearancesFilterState {
  const [applied, setApplied] = useState(false);
  const [comparison, setComparison] = useState<SerpComparison>('gt');
  const [value, setValue] = useState<number | null>(null);

  const isActive =
    applied && value !== null && Number.isFinite(value) && value >= 0;

  const publish = useCallback(() => {
    if (!isActive) {
      having.update(createClearClause(SERP_HAVING_SOURCE));
      members.update(createClearClause(SERP_MEMBERS_SOURCE));
      return;
    }

    const compare = comparison === 'lt' ? mSql.lt : mSql.gt;
    const label = `${comparison === 'lt' ? '<' : '>'} ${value}`;

    // 1. HAVING clause for the question table's own grouped query.
    updateClauseIfChanged(
      having,
      createValueClause({
        source: SERP_HAVING_SOURCE,
        value: label,
        predicate: compare(mSql.count(), mSql.literal(value)),
      }),
    );

    // 2. Membership subquery for the sibling widgets, scoped to the same
    //    context the question table sees.
    const subquery = mSql.Query.select({ question: questionExpr() })
      .from(tableName)
      .groupby(questionExpr())
      .having(compare(mSql.count(), mSql.literal(value)));

    const contextPredicate = normalizeContextPredicate(context.predicate(null));
    if (contextPredicate) {
      subquery.where(contextPredicate);
    }

    updateClauseIfChanged(
      members,
      createSubqueryClause({
        source: SERP_MEMBERS_SOURCE,
        value: label,
        predicate: buildSubqueryPredicate({
          column: QUESTION_COLUMN,
          query: subquery,
        }),
      }),
    );
  }, [isActive, value, comparison, having, members, context, tableName]);

  // Publish on input changes.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    publish();
  }, [enabled, publish]);

  // Rebuild the membership subquery when the question context changes.
  useEffect(() => {
    if (!enabled || !isActive) {
      return;
    }

    const listener = () => {
      publish();
    };

    context.addEventListener('value', listener);
    return () => {
      context.removeEventListener('value', listener);
    };
  }, [context, enabled, isActive, publish]);

  // External clears (global reset, filter-chip removal) un-apply the filter
  // so the checkbox state stays in sync and the HAVING clause is dropped too.
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const listener = () => {
      const stillPublished = members.clauses.some(
        (clause) => clause.source === SERP_MEMBERS_SOURCE,
      );

      if (!stillPublished) {
        setApplied(false);
      }
    };

    members.addEventListener('value', listener);
    return () => {
      members.removeEventListener('value', listener);
    };
  }, [isActive, members]);

  return { applied, setApplied, comparison, setComparison, value, setValue };
}

export function SerpAppearancesControls({
  state,
}: {
  state: SerpAppearancesFilterState;
}) {
  return (
    <div
      data-testid="serp-appearances-filter"
      className="flex items-center gap-2 text-xs text-slate-600"
    >
      <label className="flex items-center gap-1 font-semibold uppercase tracking-wide text-slate-500">
        <input
          data-testid="serp-appearances-apply"
          type="checkbox"
          className="size-3.5 cursor-pointer"
          checked={state.applied}
          onChange={(event) => state.setApplied(event.target.checked)}
        />
        SERP Appears
      </label>
      <select
        data-testid="serp-appearances-op"
        aria-label="SERP appearances comparison"
        className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
        value={state.comparison}
        onChange={(event) =>
          state.setComparison(event.target.value as SerpComparison)
        }
      >
        <option value="gt">&gt;</option>
        <option value="lt">&lt;</option>
      </select>
      <input
        data-testid="serp-appearances-value"
        aria-label="SERP appearances threshold"
        type="number"
        min={0}
        placeholder="N"
        className="h-7 w-16 rounded border border-slate-200 bg-white px-2 text-xs"
        value={state.value ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          state.setValue(raw === '' ? null : Number(raw));
        }}
      />
    </div>
  );
}
