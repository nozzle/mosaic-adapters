import { clauseMatch, isParam } from '@uwdata/mosaic-core';
import * as mSql from '@uwdata/mosaic-sql';
import { createStructAccess } from '../utils';
import { SqlIdentifier } from '../domain/sql-identifier';
import { BaseInputCore } from './base-input-core';
import { isScalarParamTarget, isSelectionTarget } from './guards';
import {
  subscribeParamStringSource,
  subscribeScalarParamValue,
} from './subscriptions';
import type { FilterExpr, SelectQuery } from '@uwdata/mosaic-sql';
import type {
  BaseInputCoreConfig,
  InputSubscriptionCleanup,
  MosaicInputOutputTarget,
  MosaicInputSource,
} from './types';

export type MosaicTextMatchMethod = 'contains' | 'prefix' | 'suffix' | 'regexp';

export interface MosaicTextInputOptions extends BaseInputCoreConfig {
  as: MosaicInputOutputTarget<string | null>;
  from?: MosaicInputSource;
  column?: string;
  field?: string;
  match?: MosaicTextMatchMethod;
  value?: string | null;
}

export interface MosaicTextInputState {
  value: string;
  suggestions: Array<string>;
  pending: boolean;
  error: Error | null;
}

type RowsLike = {
  toArray: () => Array<Record<string, unknown>>;
};

function hasRows(value: unknown): value is RowsLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toArray' in value &&
    typeof value.toArray === 'function'
  );
}

function normalizeValue(value: string | null | undefined): string {
  return value ?? '';
}

function readInitialValue(options: MosaicTextInputOptions): string {
  if (options.value !== undefined) {
    return normalizeValue(options.value);
  }

  if (isScalarParamTarget<string | null>(options.as)) {
    return normalizeValue(options.as.value);
  }

  return '';
}

function resolveSource(source: MosaicInputSource | undefined): string | null {
  if (isParam<string>(source)) {
    return source.value ?? null;
  }

  return source ?? null;
}

export class TextInputCore extends BaseInputCore<
  MosaicTextInputState,
  MosaicTextInputOptions
> {
  #outputCleanup: InputSubscriptionCleanup = () => {};
  #sourceCleanup: InputSubscriptionCleanup = () => {};

  constructor(options: MosaicTextInputOptions) {
    super(
      {
        value: readInitialValue(options),
        suggestions: [],
        pending: false,
        error: null,
      },
      options,
    );

    this.#bindExternalOutput();
    this.#bindSource();
  }

  setValue(value: string | null): void {
    const normalized = normalizeValue(value);

    this.setState({ value: normalized });
    this.#publish(normalized);
  }

  clear(): void {
    this.setValue('');
  }

  activate(value: string | null = this.store.state.value): void {
    const target = this.config.as;

    if (!isSelectionTarget(target)) {
      return;
    }

    target.activate(this.#createSelectionClause(normalizeValue(value)));
  }

  reset(): void {
    this.setState({ value: '' });
  }

  override requestQuery(query?: SelectQuery): Promise<unknown> | null {
    const queryToRun = query ?? this.query();

    if (!queryToRun) {
      return Promise.resolve();
    }

    return super.requestQuery(queryToRun);
  }

  override query(filter?: FilterExpr): SelectQuery | null {
    const { column, filterBy, from, enabled } = this.config;
    const resolvedSource = resolveSource(from);

    if (enabled === false) {
      return null;
    }

    if (!resolvedSource || !column) {
      return null;
    }

    const columnExpr = createStructAccess(SqlIdentifier.from(column));
    const query = mSql.Query.from(resolvedSource)
      .select({ [column]: columnExpr })
      .distinct()
      .orderby(mSql.asc(columnExpr));
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
    const column = this.config.column;
    const suggestions: Array<string> = [];

    if (column && hasRows(data)) {
      for (const row of data.toArray()) {
        const value = row[column];

        if (value !== null && value !== undefined) {
          suggestions.push(String(value));
        }
      }
    }

    this.setState({ suggestions, pending: false, error: null });
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
    previousConfig: MosaicTextInputOptions,
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
      previousConfig.column !== this.config.column ||
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

  #publish(value: string): void {
    const target = this.config.as;
    const outputValue = value === '' ? null : value;

    if (isScalarParamTarget<string | null>(target)) {
      target.update(outputValue);
      return;
    }

    if (isSelectionTarget(target)) {
      target.update(this.#createSelectionClause(value));
    }
  }

  #createSelectionClause(value: string) {
    const field = this.config.field ?? this.config.column;

    if (!field || value === '') {
      return {
        source: this,
        value: null,
        predicate: null,
      };
    }

    const columnExpr = createStructAccess(SqlIdentifier.from(field));

    return clauseMatch(columnExpr, value, {
      source: this,
      method: this.config.match ?? 'contains',
    });
  }

  #bindExternalOutput(): void {
    this.#outputCleanup();
    this.#outputCleanup = () => {};

    if (!isScalarParamTarget<string | null>(this.config.as)) {
      return;
    }

    this.#outputCleanup = subscribeScalarParamValue(this.config.as, (value) => {
      this.setState({ value: normalizeValue(value) });
    });
  }

  #bindSource(): void {
    this.#sourceCleanup();
    this.#sourceCleanup = subscribeParamStringSource(this.config.from, () => {
      this.requestQuery();
    });
  }
}
