import { describe, expect, test, vi } from 'vitest';
import { syncVgplotSelectionInteractors } from '../src/widgets/vgplot-selection-sync';
import type { Selection } from '@uwdata/mosaic-core';
import type {
  VgplotSelectionBinding,
  VgplotSelectionInteractor,
} from '../src/widgets/vgplot-selection-sync';

function selection(): Selection {
  return {} as Selection;
}

function binding(
  target: Selection,
  value: unknown,
  kind: VgplotSelectionBinding['kind'] = 'intervalX',
): VgplotSelectionBinding {
  return { selection: target, kind, active: value !== undefined, value };
}

describe('vgplot selection visual sync', () => {
  test('seeds a matching interactor before its rendering internals exist', () => {
    const target = selection();
    const reset = vi.fn();
    const interactor: VgplotSelectionInteractor = {
      selection: target,
      channel: 'x',
      reset,
    };

    syncVgplotSelectionInteractors([interactor], [binding(target, [10, 20])]);

    expect(interactor.value).toEqual([10, 20]);
    expect(reset).not.toHaveBeenCalled();
  });

  test('moves a live brush silently in pixel order without publishing', () => {
    const target = selection();
    const moveSilent = vi.fn();
    const call = vi.fn();
    const interactor: VgplotSelectionInteractor = {
      selection: target,
      channel: 'x',
      reset: vi.fn(),
      scale: { apply: (value) => 100 - Number(value) },
      brush: { moveSilent },
      g: { call },
    };

    syncVgplotSelectionInteractors([interactor], [binding(target, [10, 20])]);

    expect(interactor.value).toEqual([10, 20]);
    expect(call).toHaveBeenCalledWith(moveSilent, [80, 90]);
    expect(moveSilent).not.toHaveBeenCalled();
  });

  test('seeds an intervalXY interactor before its first render', () => {
    const target = selection();
    const interactor: VgplotSelectionInteractor = {
      selection: target,
      xfield: {},
      yfield: {},
      reset: vi.fn(),
    };
    const value = [
      [70, 90],
      [0, 20],
    ];

    syncVgplotSelectionInteractors(
      [interactor],
      [binding(target, value, 'intervalXY')],
    );

    expect(interactor.value).toEqual(value);
  });

  test('moves a live intervalXY brush silently with descending y pixels', () => {
    const target = selection();
    const moveSilent = vi.fn();
    const call = vi.fn();
    const interactor: VgplotSelectionInteractor = {
      selection: target,
      xfield: {},
      yfield: {},
      reset: vi.fn(),
      xscale: { apply: (value) => Number(value) },
      yscale: { apply: (value) => 100 - Number(value) },
      brush: { moveSilent },
      g: { call },
    };

    syncVgplotSelectionInteractors(
      [interactor],
      [
        binding(
          target,
          [
            [70, 90],
            [0, 20],
          ],
          'intervalXY',
        ),
      ],
    );

    expect(call).toHaveBeenCalledWith(moveSilent, [
      [70, 80],
      [90, 100],
    ]);
    expect(moveSilent).not.toHaveBeenCalled();
  });

  test('resets a previously painted interactor after an external clear', () => {
    const target = selection();
    const reset = vi.fn();
    const interactor: VgplotSelectionInteractor = {
      selection: target,
      value: [10, 20],
      reset,
    };

    syncVgplotSelectionInteractors([interactor], [binding(target, undefined)]);

    expect(reset).toHaveBeenCalledOnce();
  });

  test('matches by Selection identity and leaves an equal value untouched', () => {
    const other = selection();
    const target = selection();
    const otherReset = vi.fn();
    const targetReset = vi.fn();
    const interactors: Array<VgplotSelectionInteractor> = [
      { selection: other, value: [1, 2], reset: otherReset },
      {
        selection: target,
        channel: 'x',
        value: [10, 20],
        reset: targetReset,
      },
    ];

    syncVgplotSelectionInteractors(interactors, [binding(target, [10, 20])]);

    expect(interactors[0]?.value).toEqual([1, 2]);
    expect(interactors[1]?.value).toEqual([10, 20]);
    expect(otherReset).not.toHaveBeenCalled();
    expect(targetReset).not.toHaveBeenCalled();
  });

  test('degrades to domain-state sync when live private methods are incompatible', () => {
    const target = selection();
    const interactor: VgplotSelectionInteractor = {
      selection: target,
      channel: 'x',
      reset: vi.fn(),
      scale: { apply: (value) => Number(value) },
      brush: { moveSilent: vi.fn() },
      g: {
        call: () => {
          throw new Error('changed upstream signature');
        },
      },
    };

    expect(() =>
      syncVgplotSelectionInteractors([interactor], [binding(target, [10, 20])]),
    ).not.toThrow();
    expect(interactor.value).toEqual([10, 20]);
  });

  test('leaves active non-intervalX interactors untouched and clears safely', () => {
    const target = selection();
    const reset = vi.fn();
    const intervalXY: VgplotSelectionInteractor = {
      selection: target,
      value: [
        [1, 2],
        [3, 4],
      ],
      reset,
    };

    syncVgplotSelectionInteractors(
      [intervalXY],
      [
        binding(
          target,
          [
            [1, 2],
            [3, 4],
          ],
          'intervalXY',
        ),
      ],
    );
    expect(intervalXY.value).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(reset).not.toHaveBeenCalled();

    const toggleWithoutReset: VgplotSelectionInteractor = {
      selection: target,
      value: ['A'],
    };
    expect(() =>
      syncVgplotSelectionInteractors(
        [intervalXY, toggleWithoutReset],
        [binding(target, undefined, 'intervalXY')],
      ),
    ).not.toThrow();
    expect(reset).toHaveBeenCalledOnce();
    expect(toggleWithoutReset.value).toBeUndefined();
  });

  test('updates every intervalX interactor sharing a Selection', () => {
    const target = selection();
    const interactors: Array<VgplotSelectionInteractor> = [
      { selection: target, channel: 'x', reset: vi.fn() },
      { selection: target, channel: 'x', reset: vi.fn() },
    ];

    syncVgplotSelectionInteractors(interactors, [binding(target, [10, 20])]);

    expect(interactors.map((interactor) => interactor.value)).toEqual([
      [10, 20],
      [10, 20],
    ]);
  });
});
