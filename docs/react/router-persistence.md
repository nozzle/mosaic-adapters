# Router persistence recipe

Real apps sit behind a router (TanStack Router, React Router), so filter state has an obvious home: the URL. This recipe wires a [FilterSet](../core/filter-set.md) (and the per-client selections) to a router. It is written router-first; the [nozzle-paa](../../examples/react/nozzle-paa) example is the minimal, router-less reference (it writes `location.search` with `replaceState` only).

## Two lanes, one mechanism per lane

Filter state reaches the setters through one of two lanes. Pick one per piece of state — never both for the same state, or they fight.

**Lane 1 — reactive source of truth.** A store that _is_ the truth: the router's search params, a global store. Watch it; when it changes, call the setters directly. The setters _are_ the re-hydration API, so this is also the back/forward answer — a `popstate`/route change re-runs the effect and the setters replay the new state.

```tsx
// TanStack Router: search params are the source of truth.
const search = useSearch({ from: '/dashboard' });

useEffect(() => {
  // Whole-set state → the FilterSet setters.
  const specs = searchToSpecs(search);
  reconcile(filterSet, specs); // set() the present, remove() the absent

  // Per-client state → the client setters.
  facet.client.setSelected(search.domains ?? []);
  rows.client.setSelectedValues(search.picked ?? []);
  hist.client.setRange(search.range ?? null);
}, [search]);
```

`reconcile` is a small diff — `set()` every spec in the URL, `remove()` any spec id no longer present:

```ts
function reconcile(set: FilterSet, next: FilterSpec[]) {
  const nextIds = new Set(next.map((s) => s.id));
  for (const spec of set.store.state.specs) {
    if (!nextIds.has(spec.id)) {
      set.remove(spec.id);
    }
  }
  for (const spec of next) {
    set.set(spec); // SQL-unchanged upserts are suppressed, so this is cheap
  }
}
```

Writing back to the URL is a plain `navigate` in the widget handlers (or a store subscription), not a persister — the search params own the state end to end.

**Lane 2 — the passive persister.** Storage that is _not_ reactive: `localStorage`, IndexedDB, a backend, or a URL you only ever write (never watch). Wire it through `persist` and let the lifecycle drive hydration and echo suppression:

```tsx
const filterSet = createFilterSet({
  targets: { where: $where },
  persist: {
    read: () => JSON.parse(localStorage.getItem('filters') ?? 'null'),
    write: (specs) =>
      specs === null
        ? localStorage.removeItem('filters')
        : localStorage.setItem('filters', JSON.stringify(specs)),
  },
});
```

The rule: **a reactive truth drives the setters; a persister is passive storage.** If the router search is your source of truth, drive the setters from it (lane 1) and do not also give the set a persister that reads that same URL — you would hydrate twice and race the write-back.

## A persister over the router

When storage _is_ a router but you treat it as passive (write on mutation, hydrate once on mount), put `navigate` inside `write`:

```ts
const routerPersister: Persister<FilterSpec[]> = {
  read: () => searchToSpecs(router.state.location.search),
  write: (specs, { reason }) => {
    const search = specsToSearch(specs); // drop your `f.*` keys, re-add per spec
    router.navigate({
      search,
      replace: reason !== 'update', // see below
    });
  },
};
```

Map `reason` → history behavior:

| reason       | history     | why                                                                     |
| ------------ | ----------- | ----------------------------------------------------------------------- |
| `'update'`   | **push**    | a filter the user built is a navigable moment worth a back-button entry |
| `'external'` | **replace** | a chip removal is a correction, not a new place                         |
| `'clear'`    | **replace** | a reset is a correction, not a new place                                |

`'update' → push, else → replace` is a reasonable default: applying a filter is somewhere you might want to go _back_ from; removing a chip or resetting is undoing, and pushing a history entry for every correction floods back/forward with noise.

`read` runs synchronously on the module-scope set before the first query, so a shared link hydrates with zero flash. (For a `localStorage`/backend read that returns a promise, hydration is non-blocking — the first query issues unfiltered and the state applies on resolve.)

## Coalescing per-client writes

The FilterSet writes its persister **once per mutation** — it persists the whole `FilterSpec[]` as one entry, so a `reset()` is a single `write(null)`. Set-level persisters need no coalescing.

Per-client persisters are different. A chip-bar "Clear All" over N independently-persisted clients fans out N `'external'` writes in one tick — N storage commits, or N `navigate` calls that stomp each other. Coalesce them into one commit on the microtask/next tick:

```ts
let scheduled = false;

function coalescedWrite(all: () => FilterSpec[]) {
  if (scheduled) {
    return;
  }
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    commit(all()); // read the settled state after all N writes landed
  });
}
```

Each client's `write` calls `coalescedWrite`; the first schedules the flush, the rest are no-ops, and the single `commit` reads the settled combined state. A debounce (a few ms) works the same way if writes can straddle ticks. This is only needed when several _independent_ persisters back one logical reset; a single set-level persister already batches.

## Sorting and pagination

Sorting and pagination are **not** filter state — they are plain consumer React state, and the FilterSet is not involved. Initialize from storage/search on mount, and the [translators](../tanstack-table/integration.md) replay them into serializable rows-client inputs:

```tsx
const search = useSearch({ from: '/dashboard' });
const [sorting, setSorting] = useState<SortingState>(search.sort ?? []);
const [pagination, setPagination] = useState<PaginationState>(
  search.page ?? { pageIndex: 0, pageSize: 25 },
);

useMosaicRows({
  query: ({ where }) => Query.from('t').select('*').where(where),
  filterBy: $page,
  inputs: {
    orderBy: sortingToOrderBy(sorting), // translator replays it
    ...paginationToWindow(pagination),
  },
  rowCount: 'window',
});

// Write back on change (same lane-1 / navigate choice as filters).
useEffect(() => {
  navigate({ search: (s) => ({ ...s, sort: sorting, page: pagination }) });
}, [sorting, pagination]);
```

No spec, no kind, no persister — the translators (`sortingToOrderBy`, `paginationToWindow`) are pure mappers with no lifecycle, so ordinary state initialization is all it takes.

## See also

- [nozzle-paa](../../examples/react/nozzle-paa) — the wired reference: router-less by design, `location.search` written with `replaceState` only. `src/filter-url.ts` is the codec; its header comment marks where a router would swap in.
- [Filter set](../core/filter-set.md) — the set, kinds, and the persistence lifecycle.
- [Data client concepts](../core/concepts.md#persistence) — the `Persister` contract and the two-lane split for the publishing clients.
- [TanStack Table integration](../tanstack-table/integration.md) — the sorting/pagination translators and the filter bridge.
