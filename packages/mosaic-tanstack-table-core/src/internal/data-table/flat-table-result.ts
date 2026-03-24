import { logger } from '../../logger';

import type { MosaicDataTableOptions, PrimitiveSqlValue } from '../../types';
import type { RowData } from '@tanstack/table-core';

const MAX_VALIDATION_ERRORS_LOGGED = 5;

type FlatQueryResult<TData extends RowData> = {
  rows: Array<TData>;
  totalRows: number | undefined;
};

export function materializeFlatQueryResult<
  TData extends RowData,
  TValue extends PrimitiveSqlValue = PrimitiveSqlValue,
>(params: {
  rows: Array<Record<string, unknown>>;
  options: MosaicDataTableOptions<TData, TValue>;
  totalRowsColumnName: string;
  debugPrefix: string;
}): FlatQueryResult<TData> {
  const { rows, options, totalRowsColumnName, debugPrefix } = params;

  let materializedRows: Array<unknown> = rows;

  if (options.converter) {
    try {
      materializedRows = rows.map((row) => options.converter!(row));
    } catch (error) {
      logger.warn(
        'Core',
        `[MosaicDataTable ${debugPrefix}] Converter failed. Proceeding with raw data.`,
        { error },
      );
    }
  }

  if (
    options.validateRow &&
    options.validationMode &&
    options.validationMode !== 'none' &&
    materializedRows.length > 0
  ) {
    const rowsToValidate =
      options.validationMode === 'first'
        ? [materializedRows[0]]
        : materializedRows;
    let invalidCount = 0;

    rowsToValidate.forEach((row, index) => {
      if (!options.validateRow!(row)) {
        invalidCount++;
        if (
          options.validationMode === 'first' ||
          invalidCount < MAX_VALIDATION_ERRORS_LOGGED
        ) {
          logger.error(
            'Core',
            `[MosaicDataTable ${debugPrefix}] Row validation failed at index ${index}. Schema mismatch.`,
            { row },
          );
        }
      }
    });

    if (invalidCount > 0) {
      logger.warn(
        'Core',
        `[MosaicDataTable ${debugPrefix}] ${invalidCount} rows failed validation.`,
      );
    }
  }

  const typedRows = materializedRows as Array<TData>;
  const totalRows = readWindowTotalRows(
    typedRows,
    options,
    totalRowsColumnName,
  );

  return {
    rows: typedRows,
    totalRows,
  };
}

function readWindowTotalRows<TData extends RowData, TValue>(
  rows: Array<TData>,
  options: MosaicDataTableOptions<TData, TValue>,
  totalRowsColumnName: string,
): number | undefined {
  if (options.totalRowsMode !== 'window' || rows.length === 0) {
    return undefined;
  }

  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== 'object') {
    return undefined;
  }

  if (!(totalRowsColumnName in (firstRow as Record<string, unknown>))) {
    return undefined;
  }

  const rawTotal = (firstRow as Record<string, unknown>)[totalRowsColumnName];
  return Number(rawTotal);
}
