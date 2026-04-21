import { createStore } from '@tanstack/store';
import {
  applyFilterSelection,
  areFilterBindingStatesEqual,
  clearFilterSelection,
  readFilterSelectionState,
} from './helpers';
import type { Store } from '@tanstack/store';

import type {
  FilterBindingState,
  FilterRuntime,
  FilterValueKind,
} from './types';

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

  #isConnected = false;
  #syncVersion = 0;
  #selectionListener = () => {
    const syncVersion = ++this.#syncVersion;

    queueMicrotask(() => {
      if (!this.#isConnected || syncVersion !== this.#syncVersion) {
        return;
      }

      this.syncFromSelection();
    });
  };

  constructor(runtime: FilterRuntime) {
    this.runtime = runtime;
    this.store = createStore(readFilterSelectionState(runtime));
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
    applyFilterSelection(this.runtime, this.getSnapshot());
  };

  clear = (): void => {
    clearFilterSelection(this.runtime);
  };

  connect = (): void => {
    if (this.#isConnected) {
      return;
    }

    this.#isConnected = true;
    this.#syncVersion += 1;
    this.runtime.selection.addEventListener('value', this.#selectionListener);
    this.syncFromSelection();
  };

  disconnect = (): void => {
    if (!this.#isConnected) {
      return;
    }

    this.#isConnected = false;
    this.#syncVersion += 1;
    this.runtime.selection.removeEventListener(
      'value',
      this.#selectionListener,
    );
  };

  dispose = (): void => {
    this.disconnect();
  };
}
