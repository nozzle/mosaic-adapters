import * as vg from '@uwdata/vgplot';
import { useVgPlot } from '@nozzleio/react-mosaic';
import { $page, tableName } from '../page-context';

/**
 * Native vgplot on the same Selection graph. The dot mark is a MosaicClient
 * on the shared coordinator, so `filterBy: $page` cross-filters it with every
 * data client on the page — and the intervalXY brush publishes back into
 * $page, filtering the table and KPIs. useVgPlot is thin sugar that mounts
 * the element and disconnects its clients on unmount; nothing else sits
 * between vgplot and the page.
 */
export function ScatterPlot() {
  const plotRef = useVgPlot(() =>
    vg.plot(
      vg.dot(vg.from(tableName, { filterBy: $page }), {
        x: 'weight',
        y: 'height',
        fill: 'sex',
        r: 2,
        opacity: 0.1,
      }),
      vg.intervalXY({
        as: $page,
        brush: { fillOpacity: 0, stroke: 'currentColor' },
      }),
      vg.xyDomain(vg.Fixed),
      vg.colorDomain(vg.Fixed),
      vg.width(460),
      vg.height(300),
    ),
  );

  return (
    <figure
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      data-testid="scatter-plot"
    >
      <figcaption className="mb-1 text-xs uppercase tracking-wide text-slate-500">
        Weight × height — drag to brush
      </figcaption>
      <div ref={plotRef} />
    </figure>
  );
}
