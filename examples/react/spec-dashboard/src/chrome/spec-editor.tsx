/**
 * The spec editor, split into a Grafana-toolbar toggle button and the
 * collapsible code panel it reveals. The open state is owned by the dashboard
 * shell (App) so the toggle can sit in the toolbar while the panel renders as a
 * full-width strip below it.
 *
 * - **Apply** compiles the draft (`compileSpec`). On success it hands the new
 *   {@link CompiledSpec} + text up to `Bootstrap` (`onApply`), which bumps the
 *   dashboard revision and remounts the topology subtree (resetting selections
 *   and collapsing this editor). On failure it renders EVERY error message and
 *   keeps the last-good dashboard running untouched (the subtree — and this
 *   panel's draft + errors — stay intact).
 * - **Reset** restores the originally fetched text into the draft and clears the
 *   error list (no refetch, no apply).
 */
import { useState } from 'react';
import { compileSpec } from '../spec/compile';
import type { CompiledSpec } from '../spec/compile';

/** The Grafana-style toolbar button that opens/closes the editor panel. */
export function SpecEditorToggle(props: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="spec-editor-toggle"
      aria-expanded={props.open}
      onClick={props.onToggle}
      className={`flex h-7 items-center gap-1.5 rounded-gf border px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue ${
        props.open
          ? 'border-gf-blue bg-gf-blue/10 text-gf-blue'
          : 'border-line bg-panel-header text-ink hover:border-line-strong'
      }`}
    >
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M11 2.5 13.5 5 5.5 13 3 13.5 3.5 11 11 2.5Z" />
      </svg>
      Edit spec
    </button>
  );
}

export interface SpecEditorPanelProps {
  /** Whether the panel is expanded (owned by the shell). */
  open: boolean;
  /** The currently-applied spec text (seeds the draft). */
  text: string;
  /** The originally-fetched spec text (Reset target). */
  originalText: string;
  /** Hand a freshly-compiled spec + its text up to Bootstrap. */
  onApply: (compiled: CompiledSpec, text: string) => void;
}

export function SpecEditorPanel(props: SpecEditorPanelProps) {
  const { open, text, originalText, onApply } = props;
  const [draft, setDraft] = useState(text);
  const [errors, setErrors] = useState<Array<string>>([]);

  const apply = () => {
    const result = compileSpec(draft);
    if (result.ok) {
      setErrors([]);
      onApply(result.compiled, draft);
      return;
    }
    setErrors(result.errors);
  };

  const reset = () => {
    setDraft(originalText);
    setErrors([]);
  };

  if (!open) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2 border-b border-line bg-panel px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">
          Spec editor
        </span>
        {errors.length > 0 ? (
          <span className="rounded-gf border-l-2 border-gf-red bg-gf-red/10 px-2 py-0.5 text-[11px] font-semibold text-gf-red">
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <textarea
        data-testid="spec-editor-textarea"
        aria-label="Dashboard spec (YAML)"
        spellCheck={false}
        className="h-72 w-full resize-y rounded-gf border border-line bg-editor p-3 font-mono text-xs text-editor-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="spec-editor-apply"
          className="h-7 rounded-gf bg-gf-blue px-3 text-xs font-medium text-white hover:bg-gf-blue-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
          onClick={apply}
        >
          Apply
        </button>
        <button
          type="button"
          data-testid="spec-editor-reset"
          className="h-7 rounded-gf border border-line bg-panel-header px-3 text-xs font-medium text-ink hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
          onClick={reset}
        >
          Reset
        </button>
        <span className="text-[11px] text-faint">
          Apply recompiles and reloads the dashboard; invalid specs keep the
          current one running.
        </span>
      </div>

      {errors.length > 0 ? (
        <ul
          data-testid="spec-editor-errors"
          className="list-disc space-y-1 rounded-gf border border-line border-l-2 border-l-gf-red bg-gf-red/10 p-3 pl-8 text-xs text-ink"
        >
          {errors.map((error, index) => (
            <li key={index} className="font-mono">
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
