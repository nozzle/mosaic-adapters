/**
 * A control widget that drives a topology-owned `variable` (a Mosaic Param) from
 * a `<select>`. The current value is read reactively with `useMosaicParamValue`
 * off the resolved Param, and every change publishes into that same Param with
 * `param.update`, so any sibling that later consumes the variable (query binding
 * is a future slice) re-runs. Mirrors the athletes example's param-bound select,
 * and reaches the topology the house way — via `context.topology` + the
 * `resolveVariable` bridge — like every other widget in this example.
 *
 * On a value that matches no declared option the select renders a BLANK (an
 * inert placeholder option), never a silently-substituted unrelated option — the
 * least-surprising sane fallback for a control whose Param is out of range.
 */
import { useMosaicParamValue } from '@nozzleio/react-mosaic';
import { resolveVariable } from '../spec/topology';
import type { ReactElement } from 'react';
import type { VariableSelectWidgetSpec } from '../spec/schema';
import type { WidgetComponentProps, WidgetContext } from './registry';

/**
 * Thin narrowing wrapper (mirrors the other renderers): the registry hands every
 * component the widget union, so narrow on `renderer` here and render the inner
 * control, where all hooks run unconditionally on the narrowed widget.
 */
export function VariableSelectWidget({
  widget,
  context,
}: WidgetComponentProps): ReactElement | null {
  if (widget.renderer !== 'variable-select') {
    return null;
  }
  return <VariableSelect widget={widget} context={context} />;
}

interface VariableSelectProps {
  widget: VariableSelectWidgetSpec;
  context: WidgetContext;
}

function VariableSelect({
  widget,
  context,
}: VariableSelectProps): ReactElement {
  // `variable` is required and compile-validated to name a declared variable, so
  // `resolveVariable` always returns the Param (never undefined) here. The
  // explicit `<unknown>` asserts the value type at the call site instead of
  // casting the result; the `!` handles only the (unreachable) undefined ref.
  const param = resolveVariable<unknown>(context.topology, widget.variable)!;
  const current = useMosaicParamValue<unknown>(param);

  const { options } = widget;
  // Index-as-value avoids scalar↔string coercion pitfalls (0 vs '0', true vs
  // 'true', null): the DOM value is the option index, mapped back to the real
  // scalar on change. Strict equality matches string/number/boolean/null.
  const selectedIndex = options.findIndex((option) => option.value === current);
  const hasMatch = selectedIndex >= 0;

  return (
    <div
      data-testid={`variable-select-${widget.id}`}
      className="flex h-full min-h-24 flex-col rounded-gf border border-line bg-panel transition-colors hover:border-line-strong"
    >
      <div className="border-b border-line px-3 py-1.5 text-[11px] font-medium tracking-wide text-muted">
        {widget.label}
      </div>
      <div className="flex flex-1 items-center px-3 py-2">
        <select
          data-testid={`variable-select-${widget.id}-input`}
          className="h-7 w-full cursor-pointer rounded-gf border border-line bg-field px-2 text-xs text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-gf-blue"
          value={hasMatch ? String(selectedIndex) : ''}
          onChange={(event) => {
            const option = options[Number(event.target.value)];
            if (option !== undefined) {
              param.update(option.value);
            }
          }}
        >
          {/* Out-of-range Param value → an inert blank so nothing reads as
              selected; it disappears once a listed option is chosen. */}
          {hasMatch ? null : (
            <option value="" disabled>
              —
            </option>
          )}
          {options.map((option, index) => (
            <option key={index} value={String(index)}>
              {option.label ?? String(option.value)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
