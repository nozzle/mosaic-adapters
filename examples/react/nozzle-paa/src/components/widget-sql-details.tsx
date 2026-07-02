import { useCallback, useSyncExternalStore } from 'react';

/** The slice of a data-client store this footer reads. */
interface SqlStore {
  subscribe: (listener: () => void) => { unsubscribe: () => void };
  state: { lastQuery: string | null };
}

/**
 * Collapsible footer surfacing the SQL a data client last executed — read
 * from the public `lastQuery` field every client store carries.
 */
export function WidgetSqlDetails(props: { store: SqlStore }) {
  const { store } = props;
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

  if (!sql) {
    return null;
  }

  return (
    <details
      data-testid="widget-sql"
      className="border-t border-slate-200 bg-slate-50/60 px-3 py-1.5 text-[11px] text-slate-500"
    >
      <summary className="cursor-pointer font-semibold tracking-wide uppercase select-none">
        SQL
      </summary>
      <pre className="mt-1.5 max-h-44 overflow-y-auto rounded border border-slate-200 bg-white p-2 text-[10px] leading-4 break-all whitespace-pre-wrap text-slate-600">
        {sql}
      </pre>
    </details>
  );
}
