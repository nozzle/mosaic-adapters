import { isParam } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from '../utils';
import { SqlIdentifier } from '../domain/sql-identifier';
import { BaseInputCore } from './base-input-core';
import { isScalarParamTarget, isSelectionTarget } from './guards';
import { normalizeSelectOptions } from './options';
import {
  subscribeParamStringSource,
  subscribeScalarParamValue,
} from './subscriptions';
import type { Param, Selection, SelectionClause } from '@uwdata/mosaic-core';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  MosaicSelectNormalizedOption,
  MosaicSelectOption,
} from './options';
import type {
  BaseInputCoreConfig,
  InputSubscriptionCleanup,
  MosaicInputSource,
} from './types';

export type MosaicSelectListMatch = 'any' | 'all';
export type MosaicSelectOutputTarget<T = unknown> =
  | Param<T | null>
  | Param<Array<T> | null>
  | Param<T | Array<T> | null>
  | Selection;

export interface MosaicSelectInputOptions<
  T = unknown,
> extends BaseInputCoreConfig {
  as: MosaicSelectOutputTarget<T>;
  from?: MosaicInputSource;
  column?: string;
  field?: string;
  options?: Array<MosaicSelectOption<T>>;
  format?: (value: T) => string;
  value?: T | Array<T> | '' | null;
  multiple?: boolean;
  listMatch?: MosaicSelectListMatch;
  includeAll?: boolean;
}

export interface MosaicSelectInputState<T = unknown> {
  value: T | Array<T> | '' | null;
  options: Array<MosaicSelectNormalizedOption<T>>;
  pending: boolean;
  error: Error | null;
}

type RowsLike = {
  toArray: () => Array<Record<string, unknown>>;
};

const OPTION_VALUE_COLUMN = 'value';

function hasRows(value: unknown): value is RowsLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toArray' in value &&
    typeof value.toArray === 'function'
  );
}

function resolveSource(source: MosaicInputSource | undefined): string | null {
  if (isParam<string>(source)) {
    return source.value ?? null;
  }

  return source ?? null;
}

function shouldIncludeAll<T>(options: MosaicSelectInputOptions<T>): boolean {
  if (options.includeAll !== undefined) {
    return options.includeAll;
  }

  return Boolean(options.from) && options.multiple !== true;
}

function readInitialValue<T>(
  options: MosaicSelectInputOptions<T>,
): T | Array<T> | '' | null {
  if (options.value !== undefined) {
    return options.value;
  }

  if (isScalarParamTarget<T | Array<T> | null>(options.as)) {
    return normalizeExternalValue(
      options.as.value,
      options.multiple === true,
      shouldIncludeAll(options),
    );
  }

  if (options.multiple === true) {
    return [];
  }

  return shouldIncludeAll(options) ? '' : null;
}

function normalizeExternalValue<T>(
  value: T | Array<T> | null | undefined,
  multiple: boolean,
  includeAll: boolean,
): T | Array<T> | '' | null {
  if (multiple) {
    if (Array.isArray(value)) {
      return value;
    }

    if (value === null || value === undefined || value === '') {
      return [];
    }

    return [value];
  }

  if (value === undefined || value === null) {
    return includeAll ? '' : null;
  }

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}

function normalizeSetValue<T>(
  value: T | Array<T> | '' | null,
  multiple: boolean,
): T | Array<T> | '' | null {
  if (multiple) {
    if (Array.isArray(value)) {
      return value.filter((item): item is T => item !== '');
    }

    if (value === null || value === '') {
      return [];
    }

    return [value];
  }

  return value;
}

function createLiteralOptions<T>(
  options: MosaicSelectInputOptions<T>,
): Array<MosaicSelectNormalizedOption<T>> {
  return normalizeSelectOptions({
    options: options.options ?? [],
    format: options.format,
    includeAll: shouldIncludeAll(options),
  });
}

function createListPredicate(
  field: ReturnType<typeof createStructAccess>,
  values: Array<unknown>,
  listMatch: MosaicSelectListMatch,
) {
  const listLiteral = mSql.list(values as Parameters<typeof mSql.list>[0]);
  if (listMatch === 'all') {
    return mSql.listHasAll(field, listLiteral);
  }

  return mSql.listHasAny(field, listLiteral);
}

export class SelectInputCore<T = unknown> extends BaseInputCore<
  MosaicSelectInputState<T>,
  MosaicSelectInputOptions<T>
> {
  #outputCleanup: InputSubscriptionCleanup = () => {};
  #sourceCleanup: InputSubscriptionCleanup = () => {};

  constructor(options: MosaicSelectInputOptions<T>) {
    super(
      {
        value: readInitialValue(options),
        options: createLiteralOptions(options),
        pending: false,
        error: null,
      },
      options,
    );

    this.#bindExternalOutput();
    this.#bindSource();
  }

  setValue(value: T | Array<T> | '' | null): void {
    const normalized = normalizeSetValue(value, this.config.multiple === true);

    this.setState({ value: normalized });
    this.#publish(normalized);
  }

  clear(): void {
    this.setValue(this.config.multiple === true ? [] : '');
  }

  activate(value: T | Array<T> | '' | null = this.store.state.value): void {
    const target = this.config.as;

    if (!isSelectionTarget(target)) {
      return;
    }

    target.activate(this.#createSelectionClause(value));
  }

  reset(): void {
    this.setState({
      value:
        this.config.multiple === true
          ? []
          : shouldIncludeAll(this.config)
            ? ''
            : null,
    });
  }

  override requestQuery(query?: SelectQuery): Promise<unknown> | null {
    const queryToRun = query ?? this.query();

    if (!queryToRun) {
      return Promise.resolve();
    }

    return super.requestQuery(queryToRun);
  }

  override query(filter?: FilterExpr): SelectQuery | null {
    const { column, filterBy, from, enabled, listMatch } = this.config;
    const resolvedSource = resolveSource(from);

    if (enabled === false) {
      return null;
    }

    if (!resolvedSource || !column) {
      return null;
    }

    const columnExpr = createStructAccess(SqlIdentifier.from(column));
    const optionExpr = listMatch ? mSql.unnest(columnExpr) : columnExpr;
    const query = mSql.Query.from(resolvedSource)
      .select({ [OPTION_VALUE_COLUMN]: optionExpr })
      .distinct()
      .orderby(mSql.asc(OPTION_VALUE_COLUMN));
    const effectiveFilter = filterBy ? filterBy.predicate(this) : filter;

    if (effectiveFilter) {
      query.where(effectiveFilter);
    }

    return query;
  }

  override queryPending(): this {
    this.setState({ pending: true, error: null });
    return this;
  }

  override queryResult(data: unknown): this {
    const queryOptions: Array<MosaicSelectOption<T>> = [];

    if (hasRows(data)) {
      for (const row of data.toArray()) {
        const value = row[OPTION_VALUE_COLUMN];

        if (value !== null && value !== undefined) {
          queryOptions.push(value as T);
        }
      }
    }

    this.setState({
      options: normalizeSelectOptions({
        options: queryOptions,
        format: this.config.format,
        includeAll: shouldIncludeAll(this.config),
      }),
      pending: false,
      error: null,
    });
    return this;
  }

  override queryError(error: Error): this {
    this.setState({ pending: false, error });
    return this;
  }

  protected override onConnect(): void {
    this.requestQuery();
  }

  protected override onConfigChange(
    previousConfig: MosaicSelectInputOptions<T>,
  ): void {
    if (previousConfig.as !== this.config.as) {
      this.#bindExternalOutput();
      this.setState({ value: readInitialValue(this.config) });
    }

    if (previousConfig.from !== this.config.from) {
      this.#bindSource();
      this.requestQuery();
    }

    if (
      previousConfig.options !== this.config.options ||
      previousConfig.format !== this.config.format ||
      previousConfig.includeAll !== this.config.includeAll ||
      previousConfig.multiple !== this.config.multiple
    ) {
      this.setState({
        options: createLiteralOptions(this.config),
        value: normalizeSetValue(
          this.store.state.value,
          this.config.multiple === true,
        ),
      });
    }

    if (
      previousConfig.column !== this.config.column ||
      previousConfig.listMatch !== this.config.listMatch ||
      previousConfig.enabled !== this.config.enabled
    ) {
      this.requestQuery();
    }
  }

  override destroy(): void {
    this.#outputCleanup();
    this.#sourceCleanup();
    super.destroy();
  }

  #publish(value: T | Array<T> | '' | null): void {
    const target = this.config.as;
    const outputValue = this.#createOutputValue(value);

    if (isScalarParamTarget<T | Array<T> | null>(target)) {
      target.update(outputValue);
      return;
    }

    if (isSelectionTarget(target)) {
      target.update(this.#createSelectionClause(value));
    }
  }

  #createOutputValue(value: T | Array<T> | '' | null): T | Array<T> | null {
    if (this.config.multiple === true) {
      const values = Array.isArray(value) ? value : [];
      return values.length > 0 ? values : null;
    }

    if (value === '' || value === null) {
      return null;
    }

    if (Array.isArray(value)) {
      return value[0] ?? null;
    }

    return value;
  }

  #createSelectionClause(value: T | Array<T> | '' | null): SelectionClause {
    const field = this.config.field ?? this.config.column;
    const outputValue = this.#createOutputValue(value);

    if (!field || outputValue === null) {
      return {
        source: this,
        value: null,
        predicate: null,
        meta: { type: 'point' },
      };
    }

    const columnExpr = createStructAccess(SqlIdentifier.from(field));
    const values = Array.isArray(outputValue) ? outputValue : [outputValue];

    if (values.length === 0) {
      return {
        source: this,
        value: null,
        predicate: null,
        meta: { type: 'point' },
      };
    }

    const predicate = this.config.listMatch
      ? createListPredicate(columnExpr, values, this.config.listMatch)
      : mSql.isIn(
          columnExpr,
          values.map((item) => mSql.literal(item)),
        );

    return {
      source: this,
      clients: new Set([this]),
      value: outputValue,
      predicate,
      meta: { type: 'point' },
    };
  }

  #bindExternalOutput(): void {
    this.#outputCleanup();
    this.#outputCleanup = () => {};

    if (!isScalarParamTarget<T | Array<T> | null>(this.config.as)) {
      return;
    }

    this.#outputCleanup = subscribeScalarParamValue<T | Array<T> | null>(
      this.config.as,
      (value) => {
        this.setState({
          value: normalizeExternalValue(
            value,
            this.config.multiple === true,
            shouldIncludeAll(this.config),
          ),
        });
      },
    );
  }

  #bindSource(): void {
    this.#sourceCleanup();
    this.#sourceCleanup = subscribeParamStringSource(this.config.from, () => {
      this.requestQuery();
    });
  }
}
