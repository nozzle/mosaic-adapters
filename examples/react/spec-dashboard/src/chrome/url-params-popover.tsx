/**
 * A toolbar popover that lists the current URL search params reactively, so the
 * shareable-link surface is inspectable at a glance. Each row shows the param
 * name, a decoded value, and an ownership badge:
 *
 * - `spec`      — the reserved app param that selects the active dashboard.
 * - `filter`    — a param owned by the active spec's persist registry (a
 *   persisted filter value; the decoded value renders its operator + value).
 * - `selection` — a persisted standalone-Selection param (a decoded interval).
 * - `variable`  — a persisted `variable` param (the decoded scalar / array).
 * - `other`     — any foreign param (left untouched by the persisters).
 *
 * A "Copy link" button copies `window.location.href` with brief confirmation.
 * The panel is an in-flow, absolutely-positioned element inside the trigger's
 * `relative` wrapper (the same pattern as the filter builder + metric-threshold
 * popovers), so it stays anchored through scroll for free; {@link usePopoverDismiss}
 * closes it on an outside mousedown or Escape.
 */
import { useCallback, useRef, useState } from 'react';
import { usePopoverDismiss } from './use-popover-dismiss';
import type { ReactElement } from 'react';
import type { DashboardUrlInfo, ParamOwnership } from '../spec/url-state/info';
import { useSearch } from '@/router';

/** Badge text + color classes per ownership class. */
const BADGE: Record<ParamOwnership, { label: string; className: string }> = {
  spec: {
    label: 'app',
    className: 'bg-gf-orange/20 text-gf-orange',
  },
  filter: {
    label: 'filter',
    className: 'bg-gf-blue/20 text-gf-blue',
  },
  selection: {
    label: 'selection',
    className: 'bg-gf-purple/20 text-gf-purple',
  },
  variable: {
    label: 'variable',
    className: 'bg-gf-green/20 text-gf-green',
  },
  other: {
    label: 'other',
    className: 'bg-hover text-muted',
  },
};

export function UrlParamsPopover(props: {
  info: DashboardUrlInfo;
}): ReactElement {
  const { info } = props;
  const search = useSearch();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback((): void => {
    setOpen(false);
  }, []);
  usePopoverDismiss(rootRef, open, close);

  const names = Object.keys(search).sort();

  const copyLink = useCallback((): void => {
    const url = typeof window === 'undefined' ? '' : window.location.href;
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard access denied (permissions / insecure context): leave the
        // button in its default state rather than falsely reporting success.
      });
  }, []);

  return (
    <div ref={rootRef} className="relative flex shrink-0">
      <button
        type="button"
        data-testid="url-params-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="URL parameters"
        title="URL parameters"
        onClick={() => setOpen((prev) => !prev)}
        className="flex h-7 items-center gap-1.5 rounded-gf border border-line bg-field px-2 text-xs text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
      >
        <svg
          viewBox="0 0 16 16"
          className="size-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.7.7" />
          <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0l-2 2a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />
        </svg>
        <span className="tabular-nums">{names.length}</span>
      </button>

      <div
        role="dialog"
        aria-label="URL parameters"
        data-testid="url-params-panel"
        className={`absolute top-full right-0 z-30 mt-1 w-[320px] rounded-gf border border-line bg-panel p-3 text-ink shadow-lg ${
          open ? '' : 'hidden'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold tracking-wide text-muted uppercase">
            URL parameters
          </div>
          <button
            type="button"
            data-testid="url-params-copy"
            className="h-6 rounded-gf border border-line px-2 text-[11px] text-muted hover:border-line-strong hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
            onClick={copyLink}
          >
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {names.length === 0 ? (
          <div
            data-testid="url-params-empty"
            className="mt-3 text-xs text-faint"
          >
            No parameters — this is the dashboard's default view.
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {names.map((name) => {
              const ownership = info.classify(name);
              const raw = search[name] ?? '';
              const decoded = info.describe(name, raw);
              const badge = BADGE[ownership];
              return (
                <li
                  key={name}
                  data-testid={`url-param-${name}`}
                  data-ownership={ownership}
                  className="flex items-center gap-2 rounded-gf border border-line bg-field px-2 py-1 text-xs"
                >
                  <span
                    data-testid="url-param-badge"
                    className={`shrink-0 rounded-[1px] px-1 text-[9px] font-bold tracking-wider uppercase ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                  <span className="shrink-0 font-medium text-muted">
                    {name}
                  </span>
                  <span className="text-faint">=</span>
                  <span className="truncate text-ink" title={decoded ?? raw}>
                    {decoded ?? raw}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
