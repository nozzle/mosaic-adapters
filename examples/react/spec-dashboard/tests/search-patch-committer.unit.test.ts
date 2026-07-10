import { afterEach, describe, expect, test, vi } from 'vitest';
import { createSearchPatchCommitter } from '../src/spec/url-state/search-patch-committer';

afterEach(() => {
  vi.useRealTimers();
});

describe('search patch committer', () => {
  test('throttles selection changes and commits the latest merged patch', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const committer = createSearchPatchCommitter(navigate, {
      selection: 100,
      filter: 250,
    });

    committer.schedule({ 's.brush': '1..2' }, 'selection');
    committer.schedule({ 's.brush': '2..3' }, 'selection');
    committer.schedule({ foreign: null }, 'selection');
    expect(navigate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      { 's.brush': '2..3', foreign: null },
      { history: 'replace' },
    );
  });

  test('debounces filter changes and filter timing wins over selection timing', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const committer = createSearchPatchCommitter(navigate, {
      selection: 100,
      filter: 250,
    });

    committer.schedule({ 's.brush': '1..2' }, 'selection');
    vi.advanceTimersByTime(50);
    committer.schedule({ 'f.detail:domain': 's' }, 'filter');
    vi.advanceTimersByTime(200);
    committer.schedule({ 'f.detail:domain': 'st' }, 'filter');
    committer.schedule({ 's.brush': '2..3' }, 'selection');

    vi.advanceTimersByTime(249);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(navigate).toHaveBeenCalledWith(
      { 's.brush': '2..3', 'f.detail:domain': 'st' },
      { history: 'replace' },
    );
  });

  test('cancel drops queued state from a stale topology', () => {
    vi.useFakeTimers();
    const navigate = vi.fn();
    const committer = createSearchPatchCommitter(navigate, {
      selection: 100,
    });

    committer.schedule({ 's.old_brush': '1..2' }, 'selection');
    committer.cancel();
    vi.runAllTimers();

    expect(navigate).not.toHaveBeenCalled();
  });
});
