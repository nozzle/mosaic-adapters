export type MosaicSelectOption<T = unknown> =
  | T
  | {
      value: T;
      label?: string;
    };

export interface MosaicSelectNormalizedOption<T = unknown> {
  value: T | '';
  label: string;
}

export interface NormalizeSelectOptionsConfig<T = unknown> {
  options: Array<MosaicSelectOption<T>>;
  format?: (value: T) => string;
  includeAll?: boolean;
}

function isSelectOptionObject<T>(
  option: MosaicSelectOption<T>,
): option is { value: T; label?: string } {
  return (
    typeof option === 'object' &&
    option !== null &&
    !Array.isArray(option) &&
    'value' in option
  );
}

function formatLabel<T>(value: T, format?: (value: T) => string): string {
  if (format) {
    return format(value);
  }

  return String(value);
}

export function normalizeSelectOptions<T>(
  config: NormalizeSelectOptionsConfig<T>,
): Array<MosaicSelectNormalizedOption<T>> {
  const normalized = config.options.map((option) => {
    if (isSelectOptionObject(option)) {
      return {
        value: option.value,
        label: option.label ?? formatLabel(option.value, config.format),
      };
    }

    return {
      value: option,
      label: formatLabel(option, config.format),
    };
  });

  if (!config.includeAll) {
    return normalized;
  }

  return [{ value: '', label: 'All' }, ...normalized];
}
