/**
 * The "Domain spotlight" quick-filter — the page's one genuinely FOREIGN clause
 * source (issue #181 §6).
 *
 * Unlike every other control, this one does NOT author a {@link FilterSpec} on
 * the page FilterSet. It publishes a `point` clause DIRECTLY to the topology's
 * `spotlight` single Selection (resolved by ref), which the crossfilter
 * read-contexts include — so the spotlighted domain narrows the whole page.
 *
 * Because the clause is not FilterSet-sourced, it surfaces on
 * `topology.activeClauses` (the annotated foreign-clause store) and drives the
 * FOREIGN half of the {@link useActiveFilters} recipe: its chip renders in the
 * active-filter bar and is removable there (clearing the whole clause), and
 * `topology.reset()` clears it alongside the FilterSet specs. This is the
 * escape-hatch showcase: a direct-to-Selection publish the FilterSet never sees.
 */
import { useEffect, useState } from 'react';
import { clausePoint } from '@uwdata/mosaic-core';
import { column } from '@uwdata/mosaic-sql';
import {
  useMosaicActiveClauses,
  useMosaicSelectionRef,
} from '@nozzleio/react-mosaic';
import { SPOTLIGHT_ENTRY } from '../page-context';

// A stable clause source: `spotlight.remove(source)` (chip ✕) and the active-
// clause store's dedup both key on this identity, and re-publishing reuses it so
// the Selection replaces the clause instead of accumulating one per keystroke.
const SPOTLIGHT_SOURCE = { id: 'spotlight:domain' };

export function SpotlightFilter(props: { enabled: boolean }) {
  const spotlight = useMosaicSelectionRef(SPOTLIGHT_ENTRY);
  const [draft, setDraft] = useState('');

  // Mirror the committed spotlight clause into the input so external clears
  // (the chip ✕ and topology.reset / Clear All) empty the box, and a hydrated
  // clause fills it — the same "derive from state" pattern the other controls
  // use. The foreign-clause store carries the clause's value for our ref.
  const foreign = useMosaicActiveClauses();
  const committed = foreign.find((clause) => clause.ref === SPOTLIGHT_ENTRY)
    ?.clause.value;
  useEffect(() => {
    setDraft(typeof committed === 'string' ? committed : '');
  }, [committed]);

  const publish = (value: string) => {
    setDraft(value);
    if (value === '') {
      spotlight.remove(SPOTLIGHT_SOURCE);
      return;
    }
    spotlight.update(
      clausePoint(column('domain'), value, { source: SPOTLIGHT_SOURCE }),
    );
  };

  return (
    <div className="flex shrink-0 flex-col gap-1 w-[180px]">
      <label className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
        Domain Spotlight
      </label>
      <input
        data-testid="spotlight-domain-input"
        className="h-9 rounded border border-purple-200 bg-white px-3 text-sm outline-none focus:border-purple-500"
        placeholder="Spotlight a domain…"
        value={draft}
        disabled={!props.enabled}
        onChange={(event) => publish(event.target.value)}
      />
    </div>
  );
}
