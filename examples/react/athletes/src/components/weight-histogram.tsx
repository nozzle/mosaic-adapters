import { useMosaicHistogram } from '@nozzleio/react-mosaic';
import { $page, tableName } from '../page-context';
import type { HistogramBin } from '@nozzleio/react-mosaic';

function withinRange(
  bin: HistogramBin,
  range: [number, number] | null,
): boolean {
  if (range === null) {
    return false;
  }
  return bin.x0 >= range[0] && bin.x1 <= range[1];
}

function rangeEquals(
  range: [number, number] | null,
  candidate: [number, number],
): boolean {
  return (
    range !== null && range[0] === candidate[0] && range[1] === candidate[1]
  );
}

/**
 * The weight histogram as a histogram client, custom-rendered: bins over a
 * fixed extent (discovered once, unfiltered), counts cascading with every
 * other filter on the page. Clicking a bar publishes its [x0, x1) as an
 * interval clause into $page (clicking it again clears) — and crossfilter
 * self-exclusion keeps this histogram's own bins unaffected by its own brush.
 */
export function WeightHistogram() {
  const hist = useMosaicHistogram({
    from: tableName,
    column: 'weight',
    inputs: { step: 5 },
    filterBy: $page,
    publish: { as: $page },
  });

  return (
    <figure
      className="w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      data-testid="weight-histogram"
    >
      <figcaption className="mb-1 text-xs uppercase tracking-wide text-slate-500">
        Weight (kg) — click a bar to filter
      </figcaption>
      <div className="flex items-end gap-px" style={{ height: 80 }}>
        {hist.bins.map((bin) => (
          <button
            key={bin.x0}
            type="button"
            className="group relative flex-1 self-stretch"
            data-testid="histogram-bin"
            data-selected={withinRange(bin, hist.range) ? 'true' : 'false'}
            title={`${bin.x0}–${bin.x1}kg: ${bin.count.toLocaleString('en-US')} athletes`}
            onClick={() =>
              hist.client.setRange(
                rangeEquals(hist.range, [bin.x0, bin.x1])
                  ? null
                  : [bin.x0, bin.x1],
              )
            }
          >
            <span
              className={`absolute bottom-0 left-0 right-0 ${
                withinRange(bin, hist.range) ? 'bg-blue-600' : 'bg-slate-300'
              } group-hover:bg-blue-400`}
              data-testid="histogram-bar"
              data-count={bin.count}
              style={{
                height: `${hist.maxCount > 0 ? (bin.count / hist.maxCount) * 100 : 0}%`,
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-slate-400">
        <span>{hist.extent?.[0]}</span>
        <span>{hist.extent?.[1]}</span>
      </div>
    </figure>
  );
}
