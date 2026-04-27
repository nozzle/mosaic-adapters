import type { Coordinator, Param, Selection } from '@uwdata/mosaic-core';

export type InputSubscriptionCleanup = () => void;

export type MosaicInputOutputTarget<TValue = unknown> =
  | Param<TValue>
  | Selection;

export type MosaicInputSource = string | Param<string>;

export interface BaseInputCoreConfig {
  coordinator?: Coordinator | null;
  filterBy?: Selection;
  enabled?: boolean;
  __debugName?: string;
}
