import { describe, expect, test, vi } from 'vitest';
import {
  interceptOptionsForNavigationType,
  observeNavigationResult,
} from '../src/router/core';

describe('router NavigationResult handling', () => {
  test('preserves focus/scroll only for state-replacement navigations', () => {
    expect(interceptOptionsForNavigationType('replace')).toEqual({
      focusReset: 'manual',
      scroll: 'manual',
    });
    expect(interceptOptionsForNavigationType('push')).toBeUndefined();
    expect(interceptOptionsForNavigationType('traverse')).toBeUndefined();
    expect(interceptOptionsForNavigationType('reload')).toBeUndefined();
  });

  test('consumes expected supersession AbortErrors', async () => {
    const error = Object.assign(new Error('Navigation was aborted'), {
      name: 'AbortError',
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    observeNavigationResult({
      committed: Promise.reject(error),
      finished: Promise.reject(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('reports unexpected asynchronous navigation failures once', async () => {
    const error = new Error('broken navigation');
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    observeNavigationResult({
      committed: Promise.reject(error),
      finished: Promise.reject(error),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      'router: search navigation failed.',
      error,
    );
    consoleError.mockRestore();
  });
});
