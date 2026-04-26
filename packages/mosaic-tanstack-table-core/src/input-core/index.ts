export { BaseInputCore } from './base-input-core';
export { TextInputCore } from './text-input-core';
export { isScalarParamTarget, isSelectionTarget } from './guards';
export {
  InputSubscriptionBag,
  subscribeParamStringSource,
  subscribeScalarParamValue,
} from './subscriptions';
export type {
  BaseInputCoreConfig,
  InputSubscriptionCleanup,
  MosaicInputOutputTarget,
  MosaicInputSource,
} from './types';
export type {
  MosaicTextInputOptions,
  MosaicTextInputState,
  MosaicTextMatchMethod,
} from './text-input-core';
