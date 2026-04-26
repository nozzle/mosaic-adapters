import * as React from 'react';
import { useMosaicTextInput } from './text-input-hook';
import type { MosaicTextInputOptions } from './text-input-hook';

export type MosaicTextInputProps = MosaicTextInputOptions &
  Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    keyof MosaicTextInputOptions | 'defaultValue' | 'onChange' | 'onInput'
  > & {
    onValueChange?: (value: string) => void;
  };

export function MosaicTextInput({
  as,
  coordinator,
  filterBy,
  from,
  column,
  field,
  match,
  value,
  enabled,
  __debugName,
  onValueChange,
  onFocus,
  onPointerEnter,
  ...inputProps
}: MosaicTextInputProps) {
  const textInput = useMosaicTextInput({
    as,
    coordinator,
    filterBy,
    from,
    column,
    field,
    match,
    value,
    enabled,
    __debugName,
  });

  return (
    <input
      {...inputProps}
      value={textInput.value}
      onInput={(event) => {
        const nextValue = event.currentTarget.value;
        textInput.setValue(nextValue);
        onValueChange?.(nextValue);
      }}
      onFocus={(event) => {
        textInput.activate(event.currentTarget.value);
        onFocus?.(event);
      }}
      onPointerEnter={(event) => {
        textInput.activate(event.currentTarget.value);
        onPointerEnter?.(event);
      }}
    />
  );
}
