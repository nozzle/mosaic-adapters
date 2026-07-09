/**
 * The spec editor, split into a Grafana-toolbar toggle button and the
 * collapsible code panel it reveals. The open state is owned by the dashboard
 * shell (App) so the toggle can sit in the toolbar while the panel renders as a
 * full-width strip below it.
 *
 * The panel is a deliberately plain `<textarea>` (no editor library, no syntax
 * highlighting, no line numbers) with a set of "free win" affordances layered on
 * top of a single `onKeyDown` handler plus a couple of buttons:
 *
 * - **Apply** compiles the draft (`compileSpec`). On success it hands the new
 *   {@link CompiledSpec} + text up to `Bootstrap` (`onApply`), which bumps the
 *   dashboard revision and remounts the topology subtree (resetting selections
 *   and collapsing this editor). On failure it renders EVERY error message and
 *   keeps the last-good dashboard running untouched (the subtree — and this
 *   panel's draft + errors — stay intact). Also bound to **Cmd/Ctrl+Enter**.
 * - **Reset** restores the originally fetched text into the draft and clears the
 *   error list (no refetch, no apply).
 * - **Prettify** reformats the draft with `yaml`'s document mode (2-space indent,
 *   comments preserved). A parse failure surfaces its messages through the
 *   error list and leaves the text untouched. Button only — no key binding.
 * - **Keyboard shortcuts** (all on the textarea): Tab/Shift+Tab indent/dedent,
 *   Escape blurs, Alt+Arrow moves the current line/selection, Shift+Alt+Arrow
 *   duplicates it, Enter auto-indents (deepening after a trailing `:`/`-`), and
 *   Cmd/Ctrl+/ toggles YAML comments on the covered lines.
 * - A slim **status footer** reports the caret's `Ln`/`Col` and an unsaved
 *   indicator when the draft differs from the applied text.
 *
 * ## Undo preservation
 *
 * Every programmatic text mutation is applied through {@link applyTextEdit},
 * which selects the affected range and calls `document.execCommand('insertText')`
 * so the browser records the change on its native undo stack (Cmd+Z keeps
 * working) and emits an `input` event React's `onChange` picks up to keep the
 * `draft` state in sync. When `execCommand` is unavailable it falls back to
 * `setRangeText` + a manual state sync. The pure text math lives in small
 * exported helpers ({@link indentSelection}, {@link moveLines}, …) that operate
 * on a `(value, selectionStart, selectionEnd)` triple and return a
 * {@link TextEdit}; the DOM helper is the only piece that touches the element.
 */
import { useCallback, useRef, useState } from 'react';
import { parseDocument } from 'yaml';
import { compileSpec } from '../spec/compile';
import type { CompiledSpec } from '../spec/compile';

/** Which way a line-move / duplicate travels. */
export type LineDirection = 'up' | 'down';

/**
 * A programmatic text mutation: replace the `[start, end)` range of the source
 * string with `text`, then place the selection at `[selectionStart, selectionEnd]`
 * (offsets into the RESULTING string). Returned by the pure editor helpers and
 * consumed by {@link applyTextEdit}.
 */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** Count leading spaces on `line`, capped at `max` (only U+0020, not tabs). */
function leadingSpaces(line: string, max: number): number {
  let count = 0;
  while (count < max && line[count] === ' ') {
    count += 1;
  }
  return count;
}

/** The leading whitespace (spaces or tabs) of `line`. */
function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/**
 * The bounds of the full block of lines the selection `[start, end]` touches:
 * `blockStart` is the start of the first line, `blockEnd` the end of the last
 * (exclusive of the trailing newline). A selection that ends exactly at a line
 * start does not drag in the following line.
 */
function lineBlockBounds(
  value: string,
  start: number,
  end: number,
): { blockStart: number; blockEnd: number } {
  const blockStart = value.lastIndexOf('\n', start - 1) + 1;
  const effectiveEnd = end > start && value[end - 1] === '\n' ? end - 1 : end;
  const nextNewline = value.indexOf('\n', effectiveEnd);
  const blockEnd = nextNewline === -1 ? value.length : nextNewline;
  return { blockStart, blockEnd };
}

/** Whether the selection spans more than one line. */
function isMultiLine(value: string, start: number, end: number): boolean {
  return value.slice(start, end).includes('\n');
}

/**
 * Tab: a caret or single-line selection inserts two spaces (replacing the
 * selection); a multi-line selection indents every covered line by two spaces
 * and restores the selection to cover the whole block.
 */
export function indentSelection(
  value: string,
  start: number,
  end: number,
): TextEdit {
  if (!isMultiLine(value, start, end)) {
    return {
      start,
      end,
      text: '  ',
      selectionStart: start + 2,
      selectionEnd: start + 2,
    };
  }
  const { blockStart, blockEnd } = lineBlockBounds(value, start, end);
  const indented = value
    .slice(blockStart, blockEnd)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return {
    start: blockStart,
    end: blockEnd,
    text: indented,
    selectionStart: blockStart,
    selectionEnd: blockStart + indented.length,
  };
}

/**
 * Shift+Tab: remove up to two leading spaces from every covered line. A
 * multi-line selection is restored to cover the whole block; a caret / single
 * line rides left by however many spaces its own line lost. Returns null (a
 * no-op) when no line had a leading space to remove.
 */
export function dedentSelection(
  value: string,
  start: number,
  end: number,
): TextEdit | null {
  const { blockStart, blockEnd } = lineBlockBounds(value, start, end);
  const lines = value.slice(blockStart, blockEnd).split('\n');
  let removedFirst = 0;
  let removedTotal = 0;
  const dedented = lines
    .map((line, index) => {
      const strip = leadingSpaces(line, 2);
      if (index === 0) {
        removedFirst = strip;
      }
      removedTotal += strip;
      return line.slice(strip);
    })
    .join('\n');
  if (removedTotal === 0) {
    return null;
  }
  if (isMultiLine(value, start, end)) {
    return {
      start: blockStart,
      end: blockEnd,
      text: dedented,
      selectionStart: blockStart,
      selectionEnd: blockStart + dedented.length,
    };
  }
  return {
    start: blockStart,
    end: blockEnd,
    text: dedented,
    selectionStart: Math.max(blockStart, start - removedFirst),
    selectionEnd: Math.max(blockStart, end - removedFirst),
  };
}

/**
 * Move the covered line(s) up or down one line, carrying the selection with
 * them. Returns null at the first/last line (nothing to swap with).
 */
export function moveLines(
  value: string,
  start: number,
  end: number,
  direction: LineDirection,
): TextEdit | null {
  const { blockStart, blockEnd } = lineBlockBounds(value, start, end);
  const block = value.slice(blockStart, blockEnd);
  if (direction === 'up') {
    if (blockStart === 0) {
      return null;
    }
    const prevStart = value.lastIndexOf('\n', blockStart - 2) + 1;
    const prevLine = value.slice(prevStart, blockStart - 1);
    const delta = -(prevLine.length + 1);
    return {
      start: prevStart,
      end: blockEnd,
      text: `${block}\n${prevLine}`,
      selectionStart: start + delta,
      selectionEnd: end + delta,
    };
  }
  if (blockEnd === value.length) {
    return null;
  }
  const nextNewline = value.indexOf('\n', blockEnd + 1);
  const nextEnd = nextNewline === -1 ? value.length : nextNewline;
  const nextLine = value.slice(blockEnd + 1, nextEnd);
  const delta = nextLine.length + 1;
  return {
    start: blockStart,
    end: nextEnd,
    text: `${nextLine}\n${block}`,
    selectionStart: start + delta,
    selectionEnd: end + delta,
  };
}

/**
 * Duplicate the covered line(s) above or below, landing the selection on the
 * new copy.
 */
export function duplicateLines(
  value: string,
  start: number,
  end: number,
  direction: LineDirection,
): TextEdit {
  const { blockStart, blockEnd } = lineBlockBounds(value, start, end);
  const block = value.slice(blockStart, blockEnd);
  if (direction === 'up') {
    // Copy goes above and occupies the original offsets, so the selection stays.
    return {
      start: blockStart,
      end: blockStart,
      text: `${block}\n`,
      selectionStart: start,
      selectionEnd: end,
    };
  }
  const delta = block.length + 1;
  return {
    start: blockEnd,
    end: blockEnd,
    text: `\n${block}`,
    selectionStart: start + delta,
    selectionEnd: end + delta,
  };
}

/**
 * Enter: insert a newline plus the current line's leading whitespace, deepened
 * by one two-space level when the text before the caret (ignoring trailing
 * spaces) ends with `:` or `-`.
 */
export function autoIndentEnter(
  value: string,
  start: number,
  end: number,
): TextEdit {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const leading = leadingWhitespace(value.slice(lineStart));
  const beforeCaret = value.slice(lineStart, start).replace(/[ \t]+$/, '');
  const deepen =
    beforeCaret.endsWith(':') || beforeCaret.endsWith('-') ? '  ' : '';
  const text = `\n${leading}${deepen}`;
  const caret = start + text.length;
  return {
    start,
    end,
    text,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

/**
 * Cmd/Ctrl+/: toggle YAML comments on the covered lines. When every non-blank
 * line is already commented (a `#` after its leading whitespace), strip the
 * leading `# ` (or bare `#`) from each; otherwise insert `# ` after each
 * non-blank line's leading whitespace. Blank lines are left alone. Returns null
 * when the block has no non-blank line to toggle. The selection is restored to
 * cover the whole block.
 */
export function toggleComment(
  value: string,
  start: number,
  end: number,
): TextEdit | null {
  const { blockStart, blockEnd } = lineBlockBounds(value, start, end);
  const lines = value.slice(blockStart, blockEnd).split('\n');
  const nonBlank = lines.filter((line) => line.trim() !== '');
  if (nonBlank.length === 0) {
    return null;
  }
  const allCommented = nonBlank.every((line) =>
    line.replace(/^[ \t]*/, '').startsWith('#'),
  );
  const toggled = lines
    .map((line) => {
      if (line.trim() === '') {
        return line;
      }
      const leading = leadingWhitespace(line);
      const rest = line.slice(leading.length);
      if (!allCommented) {
        return `${leading}# ${rest}`;
      }
      if (rest.startsWith('# ')) {
        return `${leading}${rest.slice(2)}`;
      }
      return `${leading}${rest.slice(1)}`;
    })
    .join('\n');
  return {
    start: blockStart,
    end: blockEnd,
    text: toggled,
    selectionStart: blockStart,
    selectionEnd: blockStart + toggled.length,
  };
}

/** The 1-based line/column of `offset` within `value`. */
export function caretPosition(
  value: string,
  offset: number,
): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, value.length));
  const before = value.slice(0, clamped);
  const lastNewline = before.lastIndexOf('\n');
  const line = before.split('\n').length;
  return { line, col: clamped - lastNewline };
}

/**
 * Apply a {@link TextEdit} to a textarea while preserving the native undo stack.
 * Selects the target range and inserts via `execCommand('insertText')` (which
 * emits an `input` event React's `onChange` handles, so we do NOT set state on
 * this path). If `execCommand` is unavailable it falls back to `setRangeText`
 * and syncs state manually via `onFallbackSync`. The intended selection is
 * restored afterwards.
 */
export function applyTextEdit(
  textarea: HTMLTextAreaElement,
  edit: TextEdit,
  onFallbackSync: (value: string) => void,
): void {
  textarea.focus();
  textarea.setSelectionRange(edit.start, edit.end);
  const inserted = document.execCommand('insertText', false, edit.text);
  if (!inserted) {
    textarea.setRangeText(edit.text, edit.start, edit.end, 'end');
    onFallbackSync(textarea.value);
  }
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
}

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(text);
  const [errors, setErrors] = useState<Array<string>>([]);
  const [caret, setCaret] = useState<{ line: number; col: number }>({
    line: 1,
    col: 1,
  });

  const dirty = draft !== text;

  const syncCaret = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    setCaret(caretPosition(textarea.value, textarea.selectionStart));
  }, []);

  const apply = useCallback(() => {
    const result = compileSpec(draft);
    if (result.ok) {
      setErrors([]);
      onApply(result.compiled, draft);
      return;
    }
    setErrors(result.errors);
  }, [draft, onApply]);

  const reset = () => {
    setDraft(originalText);
    setErrors([]);
  };

  const prettify = () => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }
    const doc = parseDocument(textarea.value);
    if (doc.errors.length > 0) {
      setErrors(doc.errors.map((error) => error.message));
      return;
    }
    const formatted = doc.toString({ indent: 2 });
    const caretPos = Math.min(textarea.selectionStart, formatted.length);
    applyTextEdit(
      textarea,
      {
        start: 0,
        end: textarea.value.length,
        text: formatted,
        selectionStart: caretPos,
        selectionEnd: caretPos,
      },
      setDraft,
    );
    setErrors([]);
    syncCaret();
  };

  const applyEdit = useCallback(
    (edit: TextEdit | null) => {
      const textarea = textareaRef.current;
      if (textarea === null || edit === null) {
        return;
      }
      applyTextEdit(textarea, edit, setDraft);
      syncCaret();
    },
    [syncCaret],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    const target = event.currentTarget;
    const value = target.value;
    const from = target.selectionStart;
    const to = target.selectionEnd;
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.key === 'Enter') {
      event.preventDefault();
      apply();
      return;
    }
    if (mod && event.key === '/') {
      event.preventDefault();
      applyEdit(toggleComment(value, from, to));
      return;
    }
    // Leave every other modifier combo (Cmd+Z, Cmd+A, …) to the browser.
    if (mod) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      target.blur();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      applyEdit(
        event.shiftKey
          ? dedentSelection(value, from, to)
          : indentSelection(value, from, to),
      );
      return;
    }
    if (event.altKey && event.key === 'ArrowUp') {
      event.preventDefault();
      applyEdit(
        event.shiftKey
          ? duplicateLines(value, from, to, 'up')
          : moveLines(value, from, to, 'up'),
      );
      return;
    }
    if (event.altKey && event.key === 'ArrowDown') {
      event.preventDefault();
      applyEdit(
        event.shiftKey
          ? duplicateLines(value, from, to, 'down')
          : moveLines(value, from, to, 'down'),
      );
      return;
    }
    if (event.key === 'Enter' && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      applyEdit(autoIndentEnter(value, from, to));
    }
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
        ref={textareaRef}
        data-testid="spec-editor-textarea"
        aria-label="Dashboard spec (YAML)"
        spellCheck={false}
        className="h-[70vh] w-full resize-y rounded-gf border border-line bg-editor p-3 font-mono text-xs text-editor-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onKeyUp={syncCaret}
        onSelect={syncCaret}
        onClick={syncCaret}
      />

      <div
        data-testid="spec-editor-status"
        className="flex items-center gap-2 text-[11px] text-faint"
      >
        <span className="font-mono">
          Ln {caret.line}, Col {caret.col}
        </span>
        {dirty ? (
          <span className="flex items-center gap-1 text-gf-orange">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-gf-orange"
            />
            Unsaved changes
          </span>
        ) : null}
      </div>

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
          data-testid="spec-editor-prettify"
          className="h-7 rounded-gf border border-line bg-panel-header px-3 text-xs font-medium text-ink hover:border-line-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
          onClick={prettify}
        >
          Prettify
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
