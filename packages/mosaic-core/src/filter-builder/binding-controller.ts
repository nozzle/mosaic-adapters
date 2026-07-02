import { Store } from '@tanstack/store';
import {
  applyFilterSelection,
  areFilterBindingStatesEqual,
  clearFilterSelection,
  readFilterSelectionState,
  reapplyCommittedFilterSelection,
} from './helpers';

import type {
  FilterBindingState,
  FilterRuntime,
  FilterValueKind,
} from './types';
import type { SqlFilterClauseTarget } from '../filter-routing';

export interface FilterBindingControllerOptions {
  filterClauseTarget?: SqlFilterClauseTarget;
}

function isRangeValueKind(valueKind: FilterValueKind) {
  return valueKind === 'date-range' || valueKind === 'number-range';
}

function toRangeTuple(
  value: unknown,
  valueTo: unknown,
): [unknown | null, unknown | null] {
  if (Array.isArray(value)) {
    return [value[0] ?? null, value[1] ?? null];
  }

  return [value ?? null, valueTo ?? null];
}

export class FilterBindingController {
  readonly runtime: FilterRuntime;
  readonly store: Store<FilterBindingState>;
  readonly filterClauseTarget: SqlFilterClauseTarget;

  #isConnected = false;
  #syncVersion = 0;
  #contextVersion = 0;
  #selectionListener = () => {
    const syncVersion = ++this.#syncVersion;

    queueMicrotask(() => {
      if (!this.#isConnected || syncVersion !== this.#syncVersion) {
        return;
      }

      this.syncFromSelection();
    });
  };

  // Rebuilds a committed subquery predicate when sibling context changes.
  // Safe against feedback loops: the reapply no-ops when the rebuilt
  // predicate is unchanged, so a converged state publishes nothing.
  #contextListener = () => {
    const contextVersion = ++this.#contextVersion;

    queueMicrotask(() => {
      if (!this.#isConnected || contextVersion !== this.#contextVersion) {
        return;
      }

      reapplyCommittedFilterSelection(this.runtime, this.filterClauseTarget);
    });
  };

  constructor(
    runtime: FilterRuntime,
    options?: FilterBindingControllerOptions,
  ) {
    this.runtime = runtime;
    this.filterClauseTarget = options?.filterClauseTarget ?? 'where';
    this.store = new Store(readFilterSelectionState(runtime));
  }

  getSnapshot() {
    return this.store.state;
  }

  syncFromSelection = (): void => {
    const nextState = readFilterSelectionState(this.runtime);

    this.store.setState((previousState) => {
      if (areFilterBindingStatesEqual(previousState, nextState)) {
        return previousState;
      }

      return nextState;
    });
  };

  setOperator = (next: string): void => {
    this.store.setState((previousState) => ({
      ...previousState,
      operator: next,
    }));
  };

  setValue = (next: unknown): void => {
    this.store.setState((previousState) => {
      if (!isRangeValueKind(this.runtime.definition.valueKind)) {
        return {
          ...previousState,
          value: next,
        };
      }

      const [nextFrom, nextTo] = toRangeTuple(next, previousState.valueTo);
      return {
        ...previousState,
        value: [nextFrom, nextTo],
        valueTo: nextTo,
      };
    });
  };

  setValueTo = (next: unknown): void => {
    this.store.setState((previousState) => {
      if (!isRangeValueKind(this.runtime.definition.valueKind)) {
        return {
          ...previousState,
          valueTo: next,
        };
      }

      const [currentFrom] = toRangeTuple(
        previousState.value,
        previousState.valueTo,
      );

      return {
        ...previousState,
        value: [currentFrom, next ?? null],
        valueTo: next ?? null,
      };
    });
  };

  apply = (): void => {
    applyFilterSelection(
      this.runtime,
      this.getSnapshot(),
      this.filterClauseTarget,
    );
  };

  clear = (): void => {
    clearFilterSelection(this.runtime, this.filterClauseTarget);
  };

  connect = (): void => {
    if (this.#isConnected) {
      return;
    }

    this.#isConnected = true;
    this.#syncVersion += 1;
    this.#contextVersion += 1;
    this.runtime.selection.addEventListener('value', this.#selectionListener);

    if (this.#shouldTrackContext()) {
      this.runtime.context?.addEventListener('value', this.#contextListener);
    }

    this.syncFromSelection();
  };

  disconnect = (): void => {
    if (!this.#isConnected) {
      return;
    }

    this.#isConnected = false;
    this.#syncVersion += 1;
    this.#contextVersion += 1;
    this.runtime.selection.removeEventListener(
      'value',
      this.#selectionListener,
    );

    if (this.#shouldTrackContext()) {
      this.runtime.context?.removeEventListener('value', this.#contextListener);
    }
  };

  #shouldTrackContext(): boolean {
    return (
      this.runtime.definition.subquery != null && this.runtime.context != null
    );
  }

  dispose = (): void => {
    this.disconnect();
  };
}
