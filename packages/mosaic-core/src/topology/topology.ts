/**
 * {@link createTopology}: turns a declarative {@link TopologyConfig} into
 * resolvable, validated Selection instances — the named-Selection-graph
 * primitive. Construction *is* validation: the factory asserts as it builds and
 * throws a plain `Error` on the first violation (unknown declaration type, dot
 * in an entry name, dangling ref, bare ref to a compound entry, cycle, an
 * `external` entry without a supplied instance, or a supplied instance without
 * a declaration). After construction, `resolve(ref)` can only fail on a
 * never-declared ref.
 *
 * The composition factories in this module (`createComposedSelection`,
 * `createCascadingContexts`) and `createFilterSet` do the actual wiring; this
 * factory sequences their construction over the dependency graph and owns
 * teardown, page reset, and foreign-clause enumeration.
 */
import { Store } from '@tanstack/store';
import { Selection } from '@uwdata/mosaic-core';
import { createFilterSet } from '../filter-set/filter-set';
import { createCascadingContexts } from './cascading';
import { createComposedSelection } from './compose';
import { clearSeededClauses } from './wiring';
import type { FilterSet } from '../filter-set/types';
import type { CascadingContextsHandle } from './cascading';
import type { ComposedSelectionHandle } from './compose';
import type {
  ActiveClause,
  CascadingDeclaration,
  ComposeDeclaration,
  ExternalDeclaration,
  FilterSetDeclaration,
  StandaloneDeclaration,
  StandaloneSelectionType,
  Topology,
  TopologyActiveClausesState,
  TopologyConfig,
  TopologyDeclaration,
  TopologyOptions,
} from './types';

const STANDALONE_TYPES: ReadonlySet<string> = new Set([
  'intersect',
  'union',
  'single',
  'crossfilter',
]);

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  ...STANDALONE_TYPES,
  'compose',
  'cascading',
  'filter-set',
  'external',
]);

function createStandaloneSelection(type: StandaloneSelectionType): Selection {
  switch (type) {
    case 'crossfilter':
      return Selection.crossfilter();
    case 'union':
      return Selection.union();
    case 'single':
      return Selection.single();
    case 'intersect':
    default:
      return Selection.intersect();
  }
}

/** Splits a ref into `[entry, child]`; `child` is undefined for a bare ref. */
function parseRef(ref: string): { entry: string; child: string | undefined } {
  const dot = ref.indexOf('.');
  if (dot === -1) {
    return { entry: ref, child: undefined };
  }
  return { entry: ref.slice(0, dot), child: ref.slice(dot + 1) };
}

/**
 * Per-entry resolution record. `bareSelection` is the Selection an unadorned
 * `entry` ref resolves to (undefined for compound entries, whose bare ref is a
 * parse error). `children` maps child names to their Selections.
 */
interface EntryNode {
  declaration: TopologyDeclaration;
  bareSelection: Selection | undefined;
  children: Map<string, Selection>;
}

export function createTopology(
  config: TopologyConfig,
  options: TopologyOptions = {},
): Topology {
  const suppliedSelections = options.selections ?? {};
  const filterSetOptions = options.filterSets ?? {};

  // --- Structural validation over entry names (before any wiring). ---
  const entryNames = Object.keys(config);
  for (const name of entryNames) {
    if (name.includes('.')) {
      throw new Error(
        `[mosaic-core] createTopology: entry name '${name}' contains a dot; ` +
          `dots are reserved for the 'entry.child' ref grammar.`,
      );
    }
    const declaration = config[name];
    if (declaration === undefined || !KNOWN_TYPES.has(declaration.type)) {
      const type =
        declaration === undefined ? 'undefined' : String(declaration.type);
      throw new Error(
        `[mosaic-core] createTopology: entry '${name}' has unknown ` +
          `declaration type '${type}'. Known types: ${[...KNOWN_TYPES].join(
            ', ',
          )}.`,
      );
    }
  }

  // Strict escape hatch: every supplied instance must have an `external`
  // declaration, and every `external` declaration must have an instance.
  for (const name of Object.keys(suppliedSelections)) {
    const declaration = config[name];
    if (declaration === undefined) {
      throw new Error(
        `[mosaic-core] createTopology: options.selections['${name}'] was ` +
          `supplied but no entry '${name}' is declared in the config.`,
      );
    }
    if (declaration.type !== 'external') {
      throw new Error(
        `[mosaic-core] createTopology: options.selections['${name}'] was ` +
          `supplied but entry '${name}' is declared as '${declaration.type}', ` +
          `not 'external'.`,
      );
    }
  }
  for (const name of entryNames) {
    const declaration = config[name];
    if (
      declaration?.type === 'external' &&
      suppliedSelections[name] === undefined
    ) {
      throw new Error(
        `[mosaic-core] createTopology: entry '${name}' is declared 'external' ` +
          `but no instance was supplied in options.selections['${name}'].`,
      );
    }
  }

  // --- Track everything the topology owns for teardown. ---
  let destroyed = false;
  const nodes = new Map<string, EntryNode>();
  const composeHandles: Array<ComposedSelectionHandle> = [];
  const cascadingHandles: Array<CascadingContextsHandle> = [];
  const filterSets: Record<string, FilterSet> = {};

  // Cycle detection: `resolving` is the "currently resolving" set for the
  // recursive walk; `resolved` memoises finished entries.
  const resolving = new Set<string>();
  const resolved = new Set<string>();
  // Ordered path for a readable cycle message (e.g. `a → b → a`).
  const path: Array<string> = [];

  /**
   * Resolves a *ref* to a Selection, building dependency entries on demand.
   * Validates ref grammar (dangling entry, unknown child, bare-compound ref).
   */
  function resolveRef(ref: string): Selection {
    const { entry, child } = parseRef(ref);
    const declaration = config[entry];
    if (declaration === undefined) {
      throw new Error(
        `[mosaic-core] createTopology: ref '${ref}' points at undeclared ` +
          `entry '${entry}'.`,
      );
    }
    ensureBuilt(entry);
    const node = nodes.get(entry);
    if (node === undefined) {
      // Unreachable once ensureBuilt succeeds, but keeps the type narrow.
      throw new Error(
        `[mosaic-core] createTopology: entry '${entry}' failed to build.`,
      );
    }

    if (child === undefined) {
      if (node.bareSelection === undefined) {
        throw new Error(
          `[mosaic-core] createTopology: ref '${ref}' is a bare reference to ` +
            `compound entry '${entry}' (type '${declaration.type}'); address ` +
            `its children as '${entry}.<child>'.`,
        );
      }
      return node.bareSelection;
    }

    const childSelection = node.children.get(child);
    if (childSelection === undefined) {
      const valid = [...node.children.keys()]
        .map((name) => `${entry}.${name}`)
        .join(', ');
      throw new Error(
        `[mosaic-core] createTopology: ref '${ref}' points at unknown child ` +
          `'${child}' of entry '${entry}'. Valid children: ${valid || '(none)'}.`,
      );
    }
    return childSelection;
  }

  /** Builds an entry's Selection(s) if not already built, detecting cycles. */
  function ensureBuilt(entry: string): void {
    if (resolved.has(entry)) {
      return;
    }
    if (resolving.has(entry)) {
      const cycleStart = path.indexOf(entry);
      const cyclePath = [...path.slice(cycleStart), entry].join(' → ');
      throw new Error(
        `[mosaic-core] createTopology: dependency cycle detected: ${cyclePath}.`,
      );
    }

    resolving.add(entry);
    path.push(entry);

    const declaration = config[entry];
    // `declaration` is defined here — every entry name came from Object.keys.
    const node = buildEntry(entry, declaration as TopologyDeclaration);
    nodes.set(entry, node);

    path.pop();
    resolving.delete(entry);
    resolved.add(entry);
  }

  function buildEntry(
    entry: string,
    declaration: TopologyDeclaration,
  ): EntryNode {
    switch (declaration.type) {
      case 'intersect':
      case 'union':
      case 'single':
      case 'crossfilter':
        return buildStandalone(declaration);
      case 'external':
        return buildExternal(entry, declaration);
      case 'compose':
        return buildCompose(declaration);
      case 'cascading':
        return buildCascading(declaration);
      case 'filter-set':
        return buildFilterSet(entry, declaration);
    }
  }

  function buildStandalone(declaration: StandaloneDeclaration): EntryNode {
    return {
      declaration,
      bareSelection: createStandaloneSelection(declaration.type),
      children: new Map(),
    };
  }

  function buildExternal(
    entry: string,
    declaration: ExternalDeclaration,
  ): EntryNode {
    // Presence was asserted above; read it back here.
    const instance = suppliedSelections[entry];
    if (instance === undefined) {
      throw new Error(
        `[mosaic-core] createTopology: entry '${entry}' is declared 'external' ` +
          `but no instance was supplied in options.selections['${entry}'].`,
      );
    }
    return { declaration, bareSelection: instance, children: new Map() };
  }

  function buildCompose(declaration: ComposeDeclaration): EntryNode {
    const included = declaration.include.map((ref) => resolveRef(ref));
    const handle = createComposedSelection(included);
    composeHandles.push(handle);
    return {
      declaration,
      bareSelection: handle.selection,
      children: new Map(),
    };
  }

  function buildCascading(declaration: CascadingDeclaration): EntryNode {
    const inputs: Record<string, Selection> = {};
    for (const key of declaration.keys) {
      // A cascading key is a ref to another declared selection; the entry's
      // per-key context is addressed as `entry.key`, so the key must be a
      // plain child name (no dot) even though it *refers to* another entry.
      if (key.includes('.')) {
        throw new Error(
          `[mosaic-core] createTopology: cascading key '${key}' must be a ref ` +
            `to a bare declared selection, not a dotted child ref.`,
        );
      }
      inputs[key] = resolveRef(key);
    }
    const externals = (declaration.externals ?? []).map((ref) =>
      resolveRef(ref),
    );
    const handle = createCascadingContexts(inputs, externals);
    cascadingHandles.push(handle);
    const children = new Map<string, Selection>();
    for (const key of Object.keys(handle.contexts)) {
      const context = handle.contexts[key];
      if (context !== undefined) {
        children.set(key, context);
      }
    }
    // Compound entry: no bare Selection — its bare ref is a parse error.
    return { declaration, bareSelection: undefined, children };
  }

  function buildFilterSet(
    entry: string,
    declaration: FilterSetDeclaration,
  ): EntryNode {
    const children = new Map<string, Selection>();
    const targets: Record<string, Selection> = {};
    for (const [targetName, targetType] of Object.entries(
      declaration.targets,
    )) {
      const selection = createStandaloneSelection(targetType);
      targets[targetName] = selection;
      children.set(targetName, selection);
    }

    const context =
      declaration.context === undefined
        ? undefined
        : resolveRef(declaration.context);

    const entryOptions = filterSetOptions[entry];
    const filterSet = createFilterSet({
      targets,
      context,
      kinds: entryOptions?.kinds,
      persist: entryOptions?.persist,
    });
    filterSets[entry] = filterSet;

    // Compound entry: bare ref is a parse error; children are the targets.
    return { declaration, bareSelection: undefined, children };
  }

  // --- Eager construction: build every entry now so validation is eager. ---
  for (const entry of entryNames) {
    ensureBuilt(entry);
  }

  // --- validNames: every bare simple entry + every dotted child. ---
  const validNames = new Set<string>();
  for (const [entry, node] of nodes) {
    if (node.bareSelection !== undefined) {
      validNames.add(entry);
    }
    for (const childName of node.children.keys()) {
      validNames.add(`${entry}.${childName}`);
    }
  }

  // --- Active-clause enumeration: the annotated, deduped foreign clause set. ---
  const activeClauses = new Store<TopologyActiveClausesState>({ clauses: [] });

  /**
   * Every distinct Selection the topology observes for foreign clauses, paired
   * with its annotating entry/ref. FilterSet *target* Selections are included
   * (foreign clauses can land on them too); FilterSet-owned clauses are
   * excluded per-clause via `ownsClauseSource`. `compose`/`cascading` contexts
   * are derived mirrors of their inputs, so enumerating them would double-count
   * — they are excluded.
   */
  interface ObservedSelection {
    selection: Selection;
    entry: string;
    ref: string;
    label: string | undefined;
    meta: unknown;
  }
  const observed: Array<ObservedSelection> = [];
  for (const [entry, node] of nodes) {
    const { declaration } = node;
    if (declaration.type === 'compose' || declaration.type === 'cascading') {
      continue;
    }
    if (node.bareSelection !== undefined) {
      observed.push({
        selection: node.bareSelection,
        entry,
        ref: entry,
        label: declaration.label,
        meta: declaration.meta,
      });
    }
    for (const [childName, childSelection] of node.children) {
      observed.push({
        selection: childSelection,
        entry,
        ref: `${entry}.${childName}`,
        label: declaration.label,
        meta: declaration.meta,
      });
    }
  }

  /** True when `source` belongs to any FilterSet this topology constructed. */
  function isOwnedByAnyFilterSet(source: object): boolean {
    for (const filterSet of Object.values(filterSets)) {
      if (filterSet.ownsClauseSource(source)) {
        return true;
      }
    }
    return false;
  }

  function collectActiveClauses(): Array<ActiveClause> {
    const clauses: Array<ActiveClause> = [];
    for (const target of observed) {
      for (const clause of target.selection._resolved) {
        if (clause.predicate == null) {
          continue;
        }
        if (isOwnedByAnyFilterSet(clause.source)) {
          continue;
        }
        clauses.push({
          entry: target.entry,
          ref: target.ref,
          label: target.label,
          meta: target.meta,
          clause: {
            source: clause.source,
            value: clause.value,
            predicate: clause.predicate,
          },
        });
      }
    }
    return clauses;
  }

  function refreshActiveClauses(): void {
    if (destroyed) {
      return;
    }
    activeClauses.setState(() => ({ clauses: collectActiveClauses() }));
  }

  // Subscribe to every distinct observed Selection's `value` event.
  const clauseDetachers: Array<() => void> = [];
  const subscribed = new Set<Selection>();
  for (const target of observed) {
    if (subscribed.has(target.selection)) {
      continue;
    }
    subscribed.add(target.selection);
    const selection = target.selection;
    const listener = (): void => {
      refreshActiveClauses();
    };
    selection.addEventListener('value', listener);
    clauseDetachers.push(() =>
      selection.removeEventListener('value', listener),
    );
  }
  // Seed the store with any clauses present at construction.
  refreshActiveClauses();

  // --- reset(): type-aware, driven by declaration ownership. ---
  function reset(): void {
    if (destroyed) {
      return;
    }
    for (const [, node] of nodes) {
      const { declaration } = node;
      if (declaration.reset === false) {
        continue;
      }
      switch (declaration.type) {
        case 'intersect':
        case 'union':
        case 'single':
        case 'crossfilter':
        case 'external': {
          const selection = node.bareSelection;
          if (selection !== undefined) {
            clearSelectionClauses(selection);
          }
          break;
        }
        case 'filter-set': {
          // Delegate to the FilterSet so specs/chips stay consistent.
          break;
        }
        case 'compose':
        case 'cascading':
          // Derived — resetting the inputs is sufficient and the only correct
          // semantics.
          break;
      }
    }
    // FilterSets reset after clearing standalone/external, so a subquery
    // context clear does not leave a stale rebuild queued.
    for (const [entry, filterSet] of Object.entries(filterSets)) {
      const declaration = config[entry];
      if (declaration?.reset === false) {
        continue;
      }
      filterSet.reset();
    }
  }

  /**
   * Clears every clause currently on `selection` by publishing a null-predicate
   * clause per source (the pattern behind {@link clearSeededClauses}, applied
   * to the Selection's own clauses).
   */
  function clearSelectionClauses(selection: Selection): void {
    clearSeededClauses([selection], selection);
  }

  // --- destroy(): tear down owned compositions/FilterSets, unsubscribe all. ---
  function destroy(): void {
    if (destroyed) {
      return;
    }
    destroyed = true;
    for (const detach of clauseDetachers) {
      detach();
    }
    clauseDetachers.length = 0;
    for (const handle of composeHandles) {
      handle.destroy();
    }
    for (const handle of cascadingHandles) {
      handle.destroy();
    }
    for (const filterSet of Object.values(filterSets)) {
      filterSet.destroy();
    }
    // External instances are not owned and are never destroyed.
  }

  return {
    validNames,
    resolve: resolveRef,
    getFilterSet: (entry) => filterSets[entry],
    filterSets,
    reset,
    activeClauses,
    destroy,
    get destroyed() {
      return destroyed;
    },
  };
}
