/**
 * React test harness over the Phase 1 DuckDB harness
 * (packages/mosaic-core/tests/test-utils.ts): a minimal renderHook against
 * react-dom in jsdom, with optional StrictMode.
 */
import { StrictMode, act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import type { Root } from 'react-dom/client';

export {
  createAthletesDb,
  createTestDb,
  settle,
  waitFor,
} from '../../mosaic-core/tests/test-utils';
export type { TestDb } from '../../mosaic-core/tests/test-utils';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export interface RenderHookResult<TResult, TProps> {
  result: { current: TResult };
  rerender: (props: TProps) => Promise<void>;
  unmount: () => Promise<void>;
  /** Renders since mount — for asserting render-count behavior. */
  renders: () => number;
}

export interface RenderHookOptions<TProps> {
  initialProps: TProps;
  strict?: boolean;
  wrapper?: (children: ReactNode) => ReactNode;
}

export async function renderHook<TResult, TProps>(
  useHook: (props: TProps) => TResult,
  options: RenderHookOptions<TProps>,
): Promise<RenderHookResult<TResult, TProps>> {
  const { initialProps, strict = false, wrapper } = options;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const result: { current: TResult } = { current: undefined as TResult };
  let renderCount = 0;

  function Probe(props: { hookProps: TProps }) {
    renderCount += 1;
    result.current = useHook(props.hookProps);
    return null;
  }

  const render = async (props: TProps) => {
    const tree = wrapper ? (
      wrapper(<Probe hookProps={props} />)
    ) : (
      <Probe hookProps={props} />
    );
    await act(async () => {
      root.render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    });
  };

  await render(initialProps);

  return {
    result,
    rerender: (props: TProps) => render(props),
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    renders: () => renderCount,
  };
}

export interface RenderResult {
  container: HTMLElement;
  rerender: (ui: ReactNode) => Promise<void>;
  unmount: () => Promise<void>;
}

/** Render arbitrary UI (for tests that need real DOM, e.g. ref callbacks). */
export async function render(
  ui: ReactNode,
  options: { strict?: boolean } = {},
): Promise<RenderResult> {
  const { strict = false } = options;

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const doRender = async (tree: ReactNode) => {
    await act(async () => {
      root.render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    });
  };

  await doRender(ui);

  return {
    container,
    rerender: doRender,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** `waitFor`, but with React store updates flushed through `act`. */
export async function actWaitFor(
  assertion: () => void,
  timeoutMs = 5_000,
): Promise<void> {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
  }

  throw lastError;
}
