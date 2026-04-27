import * as React from 'react';
import { act } from 'react';
import { Store } from '@tanstack/react-store';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useMosaicSelectInput } from '../src/inputs';
import { flushEffects, render } from './test-utils';

type MockCoordinator = {
  id: string;
};

type SelectState = {
  value: unknown;
  options: Array<{ value: unknown; label: string }>;
  pending: boolean;
  error: Error | null;
};

const { mockState } = vi.hoisted(() => ({
  mockState: {
    coordinator: { id: 'context' } as MockCoordinator,
    selectClients: [] as Array<unknown>,
  },
}));

vi.mock('@nozzleio/react-mosaic', () => ({
  useCoordinator: () => mockState.coordinator,
}));

vi.mock('@nozzleio/mosaic-tanstack-table-core/input-core', () => {
  class MockSelectInputCore {
    public readonly store = new Store<SelectState>({
      value: null,
      options: [
        { value: '', label: 'All' },
        { value: 'cycling', label: 'Cycling' },
      ],
      pending: false,
      error: null,
    });
    public readonly cleanup = vi.fn();
    public readonly connect = vi.fn(() => this.cleanup);
    public readonly disconnect = vi.fn();
    public readonly destroy = vi.fn();
    public readonly updateOptions = vi.fn((options: unknown) => {
      this.options = options;
    });
    public readonly setValue = vi.fn((value: unknown) => {
      this.store.setState((state) => ({ ...state, value }));
    });
    public readonly activate = vi.fn();
    public readonly clear = vi.fn(() => {
      this.setValue('');
    });

    constructor(public options: unknown) {
      mockState.selectClients.push(this);
    }
  }

  return {
    SelectInputCore: MockSelectInputCore,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockState.coordinator = { id: 'context' };
  mockState.selectClients = [];
});

describe('useMosaicSelectInput', () => {
  test('connects only while enabled and exposes select input state/actions', async () => {
    const snapshots: Array<{
      value: unknown;
      options: Array<{ value: unknown; label: string }>;
      pending: boolean;
      error: string | null;
    }> = [];
    let controls: ReturnType<typeof useMosaicSelectInput> | undefined;

    function Probe({ enabled }: { enabled: boolean }) {
      controls = useMosaicSelectInput({
        as: {} as never,
        from: 'athletes',
        column: 'sport',
        enabled,
      });

      snapshots.push({
        value: controls.value,
        options: controls.options,
        pending: controls.pending,
        error: controls.error?.message ?? null,
      });

      return null;
    }

    const view = render(<Probe enabled={false} />);
    await flushEffects();

    const client = mockState.selectClients[0] as {
      options: unknown;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      cleanup: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      updateOptions: ReturnType<typeof vi.fn>;
      setValue: ReturnType<typeof vi.fn>;
      activate: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      store: Store<SelectState>;
    };

    expect(client.options).toMatchObject({
      coordinator: mockState.coordinator,
      enabled: false,
    });
    expect(client.connect).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);

    view.rerender(<Probe enabled={true} />);
    await flushEffects();

    expect(client.updateOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        coordinator: mockState.coordinator,
        enabled: true,
      }),
    );
    expect(client.connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      client.store.setState(() => ({
        value: 'rowing',
        options: [{ value: 'rowing', label: 'Rowing' }],
        pending: true,
        error: new Error('failed'),
      }));
    });
    await flushEffects();

    expect(snapshots.at(-1)).toEqual({
      value: 'rowing',
      options: [{ value: 'rowing', label: 'Rowing' }],
      pending: true,
      error: 'failed',
    });

    controls?.setValue('cycling');
    controls?.activate('preview');
    controls?.clear();

    expect(client.setValue).toHaveBeenCalledWith('cycling');
    expect(client.activate).toHaveBeenCalledWith('preview');
    expect(client.clear).toHaveBeenCalledTimes(1);

    view.rerender(<Probe enabled={false} />);
    await flushEffects();

    expect(client.cleanup).toHaveBeenCalledTimes(1);
    expect(client.disconnect).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(client.destroy).toHaveBeenCalledTimes(1);
  });
});
