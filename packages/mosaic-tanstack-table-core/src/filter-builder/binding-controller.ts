import { createStore } from '@tanstack/store';
import {
  applyFilterSelection,
  areFilterBindingStatesEqual,
  clearFilterSelection,
  normalizeFilterBindingState,
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

  #isDisposed = false;
  #syncVersion = 0;
  #selectionListener = () => {
    const syncVersion = ++this.#syncVersion;

    queueMicrotask(() => {
      if (this.#isDisposed || syncVersion !== this.#syncVersion) {
        return;
      }

      const nextState = normalizeFilterBindingState(
        this.runtime.definition,
        this.runtime.selection.value,
      );

      this.store.setState((previousState) => {
        if (areFilterBindingStatesEqual(previousState, nextState)) {
          return previousState;
        }

        return nextState;
      });
    });
  };

  constructor(runtime: FilterRuntime) {
    this.runtime = runtime;
    this.store = createStore(
      normalizeFilterBindingState(runtime.definition, runtime.selection.value),
    );

    this.runtime.selection.addEventListener('value', this.#selectionListener);
  }

  getSnapshot() {
    return this.store.state;
  }

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

  dispose = (): void => {
    if (this.#isDisposed) {
      return;
    }

    this.runtime.selection.removeEventListener(
      'value',
      this.#selectionListener,
    );
    this.#isDisposed = true;
  };
}
