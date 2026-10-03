import { createAthletesDb, settle, waitFor } from '@nozzleio/test-support/duckdb';
import type { TestDb } from '@nozzleio/test-support/duckdb';
import { Param, Selection } from '@uwdata/mosaic-core';
import { Query, count, gte, literal } from '@uwdata/mosaic-sql';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { createRowsClient } from '../src/index';

/**
 * Browsers pause `requestAnimationFrame` in hidden tabs, so coalesced
 * re-queries must not ride upstream's frame throttle while the document is
 * hidden. These tests stub a browser-like global environment: a
 * `requestAnimationFrame` whose callbacks only run when flushed manually
 * (never, for a paused hidden tab) and a `document` whose `visibilityState`
 * the test controls.
 */

interface AthleteRow {
  id: number;
  name: string;
  sport: string;
  weight: number;
}

interface FakeBrowser {
  /** Frame callbacks scheduled but not yet run. */
  frames: Array<FrameRequestCallback>;
  requestAnimationFrame: ReturnType<typeof vi.fn<(callback: FrameRequestCallback) => number>>;
  setVisibility: (state: DocumentVisibilityState) => void;
  /** Run every scheduled frame callback (the tab painted a frame). */
  flushFrames: () => void;
}

let db: TestDb;

beforeEach(async () => {
  db = await createAthletesDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function athleteQuery() {
  return Query.from('athletes').select('id', 'name', 'sport', 'weight');
}

/**
 * Install a fake `requestAnimationFrame` + `document`. Frames never fire on
 * their own — exactly like a hidden tab — so a re-query that waits on one
 * stays pending until `flushFrames()` runs.
 */
function stubBrowser(initialVisibility: DocumentVisibilityState | null): FakeBrowser {
  const frames: Array<FrameRequestCallback> = [];
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  const fakeDocument = { visibilityState: initialVisibility ?? 'visible' };

  vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
  if (initialVisibility !== null) {
    vi.stubGlobal('document', fakeDocument);
  }

  return {
    frames,
    requestAnimationFrame,
    setVisibility: (state) => {
      fakeDocument.visibilityState = state;
    },
    flushFrames: () => {
      const pending = frames.splice(0);
      for (const callback of pending) {
        callback(0);
      }
    },
  };
}

async function createReadyClient(
  options: Partial<Parameters<typeof createRowsClient<AthleteRow>>[0]> = {},
) {
  const client = createRowsClient<AthleteRow>({
    coordinator: db.coordinator,
    query: ({ where }) => athleteQuery().where(where),
    inputs: { orderBy: [{ column: 'id' }] },
    ...options,
  });
  await waitFor(() => {
    expect(client.store.state.status).toBe('success');
    expect(client.store.state.rows).toHaveLength(6);
  });
  return client;
}

describe('hidden tab: coalesced re-queries fall back to a timer', () => {
  test('setInputs reaches the connector while animation frames are paused', async () => {
    const client = await createReadyClient();
    const browser = stubBrowser('hidden');
    const requestUpdate = vi.spyOn(client.mosaicClient, 'requestUpdate');
    const connectorBefore = db.connectorQueries.length;

    client.setInputs({ limit: 2 });
    expect(client.store.state.status).toBe('pending');

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.id)).toEqual([1, 2]);
    });
    expect(db.connectorQueries.length).toBe(connectorBefore + 1);
    // The frame throttle was bypassed entirely: no frame was ever requested.
    expect(requestUpdate).not.toHaveBeenCalled();
    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();

    client.destroy();
  });

  test('a synchronous burst still collapses to exactly one query', async () => {
    const client = await createReadyClient();
    stubBrowser('hidden');
    const queriesBefore = db.clientQueries.length;

    client.setInputs({ limit: 4 });
    client.setInputs({ limit: 3 });
    client.setInputs({ limit: 1 });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.id)).toEqual([1]);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesBefore + 1);

    client.destroy();
  });

  test('a Param update re-queries while hidden', async () => {
    const $minWeight = Param.value(0);
    const client = await createReadyClient({
      query: ({ where }) => athleteQuery().where(gte('weight', literal($minWeight.value!)), where),
      params: { minWeight: $minWeight },
    });
    const browser = stubBrowser('hidden');

    $minWeight.update(70);

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(3);
    });
    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();

    client.destroy();
  });

  test('a havingBy update re-queries while hidden', async () => {
    const $agg = Selection.intersect();
    const client = createRowsClient<{ sport: string; total: number }>({
      coordinator: db.coordinator,
      query: ({ where, having }) =>
        Query.from('athletes')
          .select('sport', { total: count() })
          .groupby('sport')
          .where(where)
          .having(having),
      havingBy: $agg,
      inputs: { orderBy: [{ column: 'sport' }] },
    });
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(2);
    });
    const browser = stubBrowser('hidden');

    $agg.update({
      source: {},
      value: 3,
      fields: [],
      predicate: gte('total', literal(3)),
    });

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.sport)).toEqual(['swim']);
    });
    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();

    client.destroy();
  });

  test('a trigger after becoming visible joins the pending hidden-tab flush', async () => {
    const client = await createReadyClient();
    const browser = stubBrowser('hidden');
    const requestUpdate = vi.spyOn(client.mosaicClient, 'requestUpdate');
    const queriesBefore = db.clientQueries.length;

    client.setInputs({ limit: 3 });
    browser.setVisibility('visible');
    client.setInputs({ limit: 1 });

    // The pending timer flush already reads the latest inputs, so no frame
    // is requested on top of it.
    expect(requestUpdate).not.toHaveBeenCalled();
    expect(browser.requestAnimationFrame).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.id)).toEqual([1]);
    });
    await settle();
    expect(db.clientQueries.length).toBe(queriesBefore + 1);

    client.destroy();
  });

  test('destroy() cancels a pending hidden-tab flush', async () => {
    const client = await createReadyClient();
    stubBrowser('hidden');
    const queriesBefore = db.clientQueries.length;

    client.setInputs({ limit: 2 });
    client.destroy();
    await settle();

    expect(db.clientQueries.length).toBe(queriesBefore);
  });
});

describe('visible tab: coalesced re-queries keep the upstream frame throttle', () => {
  test('setInputs goes through requestUpdate() and waits for a frame', async () => {
    const client = await createReadyClient();
    const browser = stubBrowser('visible');
    const requestUpdate = vi.spyOn(client.mosaicClient, 'requestUpdate');
    const queriesBefore = db.clientQueries.length;

    client.setInputs({ limit: 3 });
    client.setInputs({ limit: 2 });

    expect(requestUpdate).toHaveBeenCalledTimes(2);
    expect(browser.requestAnimationFrame).toHaveBeenCalledTimes(1);

    // No frame painted yet: the re-query has not been built.
    await settle();
    expect(db.clientQueries.length).toBe(queriesBefore);
    expect(client.store.state.status).toBe('pending');

    browser.flushFrames();
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.id)).toEqual([1, 2]);
    });
    expect(db.clientQueries.length).toBe(queriesBefore + 1);

    client.destroy();
  });

  test('visibility is checked per trigger, not cached', async () => {
    const client = await createReadyClient();
    const browser = stubBrowser('hidden');
    const requestUpdate = vi.spyOn(client.mosaicClient, 'requestUpdate');

    client.setInputs({ limit: 4 });
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(4);
    });
    expect(requestUpdate).not.toHaveBeenCalled();

    browser.setVisibility('visible');
    client.setInputs({ limit: 1 });
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    expect(browser.requestAnimationFrame).toHaveBeenCalledTimes(1);

    browser.flushFrames();
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows.map((r) => r.id)).toEqual([1]);
    });

    client.destroy();
  });

  test('requestAnimationFrame without a document keeps the frame path', async () => {
    const client = await createReadyClient();
    // `null`: install `requestAnimationFrame` but no `document` (a worker).
    const browser = stubBrowser(null);
    const requestUpdate = vi.spyOn(client.mosaicClient, 'requestUpdate');

    client.setInputs({ limit: 2 });
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    expect(browser.requestAnimationFrame).toHaveBeenCalledTimes(1);

    browser.flushFrames();
    await waitFor(() => {
      expect(client.store.state.status).toBe('success');
      expect(client.store.state.rows).toHaveLength(2);
    });

    client.destroy();
  });
});
