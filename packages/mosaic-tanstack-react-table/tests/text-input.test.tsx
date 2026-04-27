import * as React from 'react';
import { act } from 'react';
import { Store } from '@tanstack/react-store';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useMosaicTextInput } from '../src/inputs';
import { flushEffects, render } from './test-utils';

type MockCoordinator = {
  id: string;
};

const { mockState } = vi.hoisted(() => ({
  mockState: {
    coordinator: { id: 'context' } as MockCoordinator,
    textClients: [] as Array<unknown>,
  },
}));

vi.mock('@nozzleio/react-mosaic', () => ({
  useCoordinator: () => mockState.coordinator,
}));

vi.mock('@nozzleio/mosaic-tanstack-table-core/input-core', () => {
  class MockTextInputCore {
    public readonly store = new Store({
      value: '',
      suggestions: [] as Array<string>,
      pending: false,
      error: null as Error | null,
    });
    public readonly cleanup = vi.fn();
    public readonly connect = vi.fn(() => this.cleanup);
    public readonly disconnect = vi.fn();
    public readonly destroy = vi.fn();
    public readonly updateOptions = vi.fn((options: unknown) => {
      this.options = options;
    });
    public readonly setValue = vi.fn((value: string | null) => {
      this.store.setState((state) => ({ ...state, value: value ?? '' }));
    });
    public readonly activate = vi.fn();
    public readonly clear = vi.fn(() => {
      this.setValue('');
    });

    constructor(public options: unknown) {
      mockState.textClients.push(this);
    }
  }

  return {
    TextInputCore: MockTextInputCore,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockState.coordinator = { id: 'context' };
  mockState.textClients = [];
});

describe('useMosaicTextInput', () => {
  test('connects only while enabled and exposes text input state/actions', async () => {
    const snapshots: Array<{
      value: string;
      suggestions: Array<string>;
      pending: boolean;
      error: string | null;
    }> = [];
    let controls: ReturnType<typeof useMosaicTextInput> | undefined;

    function Probe({ enabled }: { enabled: boolean }) {
      controls = useMosaicTextInput({
        as: {} as never,
        from: 'athletes',
        column: 'sport',
        enabled,
      });

      snapshots.push({
        value: controls.value,
        suggestions: controls.suggestions,
        pending: controls.pending,
        error: controls.error?.message ?? null,
      });

      return null;
    }

    const view = render(<Probe enabled={false} />);
    await flushEffects();

    const client = mockState.textClients[0] as {
      options: unknown;
      connect: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
      cleanup: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      updateOptions: ReturnType<typeof vi.fn>;
      setValue: ReturnType<typeof vi.fn>;
      activate: ReturnType<typeof vi.fn>;
      clear: ReturnType<typeof vi.fn>;
      store: Store<{
        value: string;
        suggestions: Array<string>;
        pending: boolean;
        error: Error | null;
      }>;
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
        value: 'row',
        suggestions: ['rowing'],
        pending: true,
        error: new Error('failed'),
      }));
    });
    await flushEffects();

    expect(snapshots.at(-1)).toEqual({
      value: 'row',
      suggestions: ['rowing'],
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
