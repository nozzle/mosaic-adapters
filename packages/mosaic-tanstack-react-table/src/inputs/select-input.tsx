import * as React from 'react';
import { useMosaicSelectInput } from './select-input-hook';
import type { MosaicSelectInputOptions } from './select-input-hook';
import type { MosaicSelectNormalizedOption } from '@nozzleio/mosaic-tanstack-table-core/input-core';

export type MosaicSelectProps<T = unknown> = MosaicSelectInputOptions<T> &
  Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    | keyof MosaicSelectInputOptions<T>
    | 'defaultValue'
    | 'multiple'
    | 'onChange'
    | 'onInput'
    | 'value'
  > & {
    onValueChange?: (value: T | Array<T> | '' | null) => void;
  };

function findOptionIndex<T>(
  options: Array<MosaicSelectNormalizedOption<T>>,
  value: T | '' | null | undefined,
): number {
  return options.findIndex((option) => Object.is(option.value, value));
}

function selectedValueProp<T>(
  options: Array<MosaicSelectNormalizedOption<T>>,
  value: T | Array<T> | '' | null,
  multiple: boolean,
): string | Array<string> {
  if (multiple) {
    const values = Array.isArray(value) ? value : [];
    return values.flatMap((item) => {
      const index = findOptionIndex(options, item);
      return index >= 0 ? [String(index)] : [];
    });
  }

  const scalarValue = Array.isArray(value) ? (value[0] ?? null) : value;
  const index = findOptionIndex(options, scalarValue);
  return index >= 0 ? String(index) : '';
}

function readSelectedValue<T>(
  element: HTMLSelectElement,
  options: Array<MosaicSelectNormalizedOption<T>>,
  multiple: boolean,
): T | Array<T> | '' | null {
  if (multiple) {
    const values = Array.from(element.selectedOptions).flatMap((option) => {
      const normalized = options[Number(option.value)];

      if (!normalized || normalized.value === '') {
        return [];
      }

      return [normalized.value];
    });

    return values;
  }

  const normalized = options[Number(element.value)];
  return normalized?.value ?? null;
}

export function MosaicSelect<T = unknown>({
  as,
  coordinator,
  filterBy,
  from,
  column,
  field,
  options,
  format,
  value,
  multiple,
  listMatch,
  includeAll,
  enabled,
  __debugName,
  onValueChange,
  onFocus,
  onPointerEnter,
  ...selectProps
}: MosaicSelectProps<T>) {
  const selectInput = useMosaicSelectInput<T>({
    as,
    coordinator,
    filterBy,
    from,
    column,
    field,
    options,
    format,
    value,
    multiple,
    listMatch,
    includeAll,
    enabled,
    __debugName,
  });
  const isMultiple = multiple === true;
  const selectedValue = selectedValueProp(
    selectInput.options,
    selectInput.value,
    isMultiple,
  );

  return (
    <select
      {...selectProps}
      multiple={isMultiple}
      value={selectedValue}
      onChange={(event) => {
        const nextValue = readSelectedValue(
          event.currentTarget,
          selectInput.options,
          isMultiple,
        );
        selectInput.setValue(nextValue);
        onValueChange?.(nextValue);
      }}
      onFocus={(event) => {
        selectInput.activate(
          readSelectedValue(
            event.currentTarget,
            selectInput.options,
            isMultiple,
          ),
        );
        onFocus?.(event);
      }}
      onPointerEnter={(event) => {
        selectInput.activate(
          readSelectedValue(
            event.currentTarget,
            selectInput.options,
            isMultiple,
          ),
        );
        onPointerEnter?.(event);
      }}
    >
      {selectInput.options.map((option, index) => (
        <option key={index} value={String(index)}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
