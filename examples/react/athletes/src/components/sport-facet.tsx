import { useMosaicFacet } from '@nozzleio/react-mosaic';
import { $page, tableName } from '../page-context';

/**
 * The sport filter as a facet client: data-driven options with cascading
 * counts, publishing a point clause into $page. The published clause carries
 * this client for cross-mode self-exclusion, so the option list is filtered
 * by every *other* control on the page (brush, column filters) but never by
 * its own selection — the counts cascade, the options never ghost away.
 */
export function SportFacet() {
  const facet = useMosaicFacet({
    from: tableName,
    column: 'sport',
    filterBy: $page,
    publish: { as: $page },
  });

  const selected = facet.selected[0];
  // A peer filter can cascade the selected sport's count to zero and drop it
  // from the options; keep it renderable so the select never shows a
  // mismatched value.
  const options = facet.options.some((option) =>
    Object.is(option.value, selected),
  )
    ? facet.options
    : selected !== undefined
      ? [...facet.options, { value: selected }]
      : facet.options;

  return (
    <label className="flex w-64 flex-col gap-1 text-xs text-slate-500">
      Sport
      <select
        className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
        data-testid="sport-facet"
        value={selected === undefined ? '' : String(selected)}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '') {
            facet.client.clear();
            return;
          }
          facet.client.toggle(next);
        }}
      >
        <option value="">All sports</option>
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {String(option.value)}
            {option.count === undefined
              ? ''
              : ` (${option.count.toLocaleString('en-US')})`}
          </option>
        ))}
      </select>
    </label>
  );
}
