/**
 * Metric-threshold widget filter — every summary card gets one, on its own
 * computed metric column.
 *
 * The whole filter is one `metric:<card>` spec on the page {@link filterSet},
 * resolved by the `metric-threshold` kind (page-context.ts) into two clauses: a
 * HAVING on the card's own grouped query and a membership subquery narrowing
 * every sibling. The control derives its applied state from the spec's presence
 * in the set store, so chip removal / Clear All unchecks it for free. Only the
 * comparison and value drafts are local; while applied, edits re-`set`
 * (debounced) and clearing the checkbox `remove`s the spec.
 */
import { useEffect, useState } from 'react';
import { useFilterSetState } from '@nozzleio/react-mosaic';
import { metricChipLabels } from '../page-context';
import { usePaaFilterSet } from '../topology';
import type { FilterSpec } from '@nozzleio/react-mosaic';
import type { SummaryTableId } from '../page-context';

export interface MetricThresholdConfig {
  id: SummaryTableId;
  /** Group-by column — the spec column and membership group key. */
  groupBy: string;
}

export type MetricComparison = 'gt' | 'lt';

export interface MetricThresholdFilterState {
  config: MetricThresholdConfig;
  applied: boolean;
  setApplied: (next: boolean) => void;
  comparison: MetricComparison;
  setComparison: (next: MetricComparison) => void;
  value: number | null;
  setValue: (next: number | null) => void;
}

function specId(id: SummaryTableId): string {
  return `metric:${id}`;
}

/** Reads the committed metric spec for a card from the set store. */
function useMetricSpec(id: SummaryTableId): FilterSpec | undefined {
  const filterSet = usePaaFilterSet();
  const { specs } = useFilterSetState(filterSet);
  return specs.find((spec) => spec.id === specId(id));
}

export function useMetricThresholdFilter(options: {
  config: MetricThresholdConfig;
  enabled: boolean;
}): MetricThresholdFilterState {
  const { config } = options;
  const filterSet = usePaaFilterSet();
  const spec = useMetricSpec(config.id);
  const applied = spec !== undefined;

  // Comparison/value drafts are local; when applied they seed from the spec so
  // an external hydrate/adopt is reflected in the controls.
  const [comparison, setComparison] = useState<MetricComparison>('gt');
  const [value, setValue] = useState<number | null>(null);

  // Reflect the committed spec into the drafts (hydration, external edits).
  useEffect(() => {
    if (spec === undefined) {
      return;
    }
    if (spec.operator === 'gt' || spec.operator === 'lt') {
      setComparison(spec.operator);
    }
    if (typeof spec.value === 'number') {
      setValue(spec.value);
    }
  }, [spec]);

  const publish = (
    nextApplied: boolean,
    nextComparison: MetricComparison,
    nextValue: number | null,
  ): void => {
    const active =
      nextApplied &&
      nextValue !== null &&
      Number.isFinite(nextValue) &&
      nextValue >= 0;
    if (!active) {
      filterSet.remove(specId(config.id));
      return;
    }
    filterSet.set({
      id: specId(config.id),
      column: config.groupBy,
      kind: 'metric-threshold',
      operator: nextComparison,
      value: nextValue,
      label: metricChipLabels[config.id],
    });
  };

  return {
    config,
    applied,
    setApplied: (next) => publish(next, comparison, value),
    comparison,
    setComparison: (next) => {
      setComparison(next);
      publish(applied, next, value);
    },
    value,
    setValue: (next) => {
      setValue(next);
      publish(applied, comparison, next);
    },
  };
}

export function MetricThresholdControls(props: {
  state: MetricThresholdFilterState;
}) {
  const { state } = props;
  const { id } = state.config;
  return (
    <div
      data-testid={`metric-filter-${id}`}
      className="flex items-center gap-2 text-xs text-slate-600"
    >
      <label className="flex items-center gap-1 font-semibold tracking-wide text-slate-500 uppercase">
        <input
          data-testid={`metric-filter-${id}-apply`}
          type="checkbox"
          className="size-3.5 cursor-pointer"
          checked={state.applied}
          onChange={(event) => state.setApplied(event.target.checked)}
        />
        {metricChipLabels[id]}
      </label>
      <select
        data-testid={`metric-filter-${id}-op`}
        aria-label={`${metricChipLabels[id]} comparison`}
        className="h-7 rounded border border-slate-200 bg-white px-1 text-xs"
        value={state.comparison}
        onChange={(event) =>
          state.setComparison(event.target.value as MetricComparison)
        }
      >
        <option value="gt">&gt;</option>
        <option value="lt">&lt;</option>
      </select>
      <input
        data-testid={`metric-filter-${id}-value`}
        aria-label={`${metricChipLabels[id]} threshold`}
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
