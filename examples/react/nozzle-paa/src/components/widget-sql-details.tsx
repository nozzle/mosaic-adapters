import { QueryError } from '@uwdata/mosaic-core';
import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { usePopoverDismiss } from './use-popover-dismiss';

/** The slice of a data-client store this control reads. */
interface SqlStore {
  subscribe: (listener: () => void) => { unsubscribe: () => void };
  state: { lastQuery: string | null; error: Error | null };
}

/**
 * A header trigger + popover surfacing the SQL a data client last executed —
 * read from the public `lastQuery` field every client store carries.
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
export function WidgetSqlPopover(props: { store: SqlStore; label: string }) {
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
  const error = useSyncExternalStore(
    subscribe,
    () => store.state.error,
    () => store.state.error,
  );
  const queryError = error instanceof QueryError ? error : null;
  const causeMessage =
    queryError?.cause instanceof Error
      ? queryError.cause.message
      : String(queryError?.cause ?? '');

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  usePopoverDismiss(rootRef, open, close);

  if (!sql && queryError === null) {
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
        className="h-7 rounded px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
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
        className={`absolute top-full right-3 left-3 z-30 mt-1 rounded border border-slate-200 bg-white p-3 shadow-lg ${
          open ? '' : 'hidden'
        }`}
      >
        {sql ? (
          <>
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              Last executed SQL
            </div>
            <pre className="max-h-[360px] overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap text-slate-600">
              {sql}
            </pre>
          </>
        ) : null}
        {queryError ? (
          <div data-testid="widget-sql-error" className={sql ? 'mt-3' : ''}>
            <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-red-600 uppercase">
              Failed SQL
            </div>
            <pre className="max-h-[360px] overflow-auto rounded border border-red-200 bg-red-50 p-2 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap text-red-700">
              {queryError.sql}
            </pre>
            <div className="mt-2 mb-1.5 text-[11px] font-semibold tracking-wide text-red-600 uppercase">
              Cause
            </div>
            <div
              data-testid="widget-sql-error-cause"
              className="rounded border border-red-200 bg-red-50 p-2 font-mono text-[11px] leading-4 break-all whitespace-pre-wrap text-red-700"
            >
              {causeMessage}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
