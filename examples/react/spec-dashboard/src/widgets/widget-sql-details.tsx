/**
 * A header trigger + popover surfacing the SQL a data client last executed —
 * read from the public `lastQuery` field every client store carries. Used by
 * the summary and detail tables.
 *
 * The trigger is styled like the tables' other header buttons (e.g. Enlarge);
 * clicking it opens a wide, monospace panel roomy enough to read a generated
 * query. It follows the example's one popover idiom — a `display:contents`
 * wrapper (so the button stays in the header's flex flow) whose `absolute`
 * panel anchors to the enclosing header (which the caller marks `relative`) and
 * spans the card width, staying within the card's `overflow-hidden` box rather
 * than being clipped. {@link usePopoverDismiss} closes it on an outside
 * mousedown or Escape; the panel stays mounted (hidden) while closed.
 */
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { usePopoverDismiss } from '../chrome/use-popover-dismiss';
import type { ReactElement } from 'react';

/** The slice of a data-client store this control reads. */
interface SqlStore {
  subscribe: (listener: () => void) => { unsubscribe: () => void };
  state: { lastQuery: string | null };
}

export function WidgetSqlPopover(props: {
  store: SqlStore;
  label: string;
}): ReactElement | null {
  const { store, label } = props;
  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = store.subscribe(onChange);
      return () => {
        subscription.unsubscribe();
      };
    },
    [store],
  );
  const sql = useSyncExternalStore(
    subscribe,
    () => store.state.lastQuery,
    () => store.state.lastQuery,
  );

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  usePopoverDismiss(rootRef, open, close);

  if (!sql) {
    return null;
  }

  return (
    <div ref={rootRef} className="contents">
      <button
        type="button"
        data-testid="widget-sql-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Show SQL for ${label}`}
        className="flex h-6 items-center rounded-gf border border-line bg-panel-header px-2 text-[11px] font-medium text-muted hover:border-line-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
        onClick={() => setOpen((prev) => !prev)}
      >
        SQL
      </button>
      {/* Stays mounted while closed (`hidden`) so the panel keeps its scroll
          position across an open/close. Anchored to the enclosing `relative`
          header and inset from both card edges, so it spans the card width and
          stays inside the card's `overflow-hidden` box. z-30 clears the sticky
          table header (z-10). */}
      <div
        data-testid="widget-sql"
        role="dialog"
        aria-label={`SQL for ${label}`}
        className={`absolute top-full right-2 left-2 z-30 mt-1 rounded-gf border border-line bg-panel p-3 shadow-lg ${
          open ? '' : 'hidden'
        }`}
      >
        <div className="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
          Last executed SQL
        </div>
        <pre className="max-h-[360px] overflow-auto rounded-gf border border-line bg-editor p-2 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap text-editor-ink">
          {sql}
        </pre>
      </div>
    </div>
  );
}
