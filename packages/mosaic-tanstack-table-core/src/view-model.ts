/**
 * Provides a configuration-driven lifecycle for dashboard analytical models.
 * Manages selections, topology setup, and coordinated resource cleanup.
 */

import type { Coordinator, MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

/**
 * Configuration for a Mosaic ViewModel.
 * Encapsulates the behavior and metadata for a specific analytical view.
 */
export interface MosaicViewModelConfig<T extends MosaicViewModel = any> {
  /** Callback to clear all logical selections managed by the dashboard */
  reset: (model: T) => void;
  /** Setup selection topology and listeners. Called during model connection. */
  setupTopology?: (model: T) => void;
  /** Metadata map for columns used to resolve getColumnMeta calls */
  columnMeta?: Record<
    string,
    MosaicDataTableColumnDefMetaOptions['mosaicDataTable']
  >;
}

export class MosaicViewModel {
  public coordinator: Coordinator;
  private _config: MosaicViewModelConfig;

  // Store unsubscribe functions for cleanup (listeners, bridges, etc)
  private _disposables: Array<() => void> = [];

  constructor(coordinator: Coordinator, config: MosaicViewModelConfig) {
    this.coordinator = coordinator;
    this._config = config;
  }

  /**
   * Executes the reset logic provided in the configuration.
   */
  public reset(): void {
    this._config.reset(this);
  }

  /**
   * Updates the coordinator reference.
   */
  public setCoordinator(coordinator: Coordinator) {
    this.coordinator = coordinator;
  }

  /**
   * The entry point. Connects all selections and internal listeners.
   * Call this when the View mounts.
   */
  public connect(): () => void {
    // 1. Run Setup Logic from config
    if (this._config.setupTopology) {
      this._config.setupTopology(this);
    }

    // 2. Return a cleanup function for React/Frameworks to call on unmount
    return () => this.disconnect();
  }

  public disconnect(): void {
    // Early exit if no disposables exist
    if (this._disposables.length === 0) {
      return;
    }

    // Execute all cleanups in reverse order (LIFO)
    for (let i = this._disposables.length - 1; i >= 0; i--) {
      const dispose = this._disposables[i];
      if (dispose) {
        dispose();
      }
    }
    this._disposables = [];
  }

  /**
   * Register a cleanup function to be called when the model disconnects.
   */
  public register(cleanup: () => void) {
    this._disposables.push(cleanup);
  }

  /**
   * Helper to add listeners that are automatically cleaned up.
   */
  public listen(
    selection: Selection,
    event: 'value' | 'active',
    handler: () => void,
  ) {
    selection.addEventListener(event, handler);
    this.register(() => selection.removeEventListener(event, handler));
  }

  /**
   * Helper: Connect a child MosaicClient.
   */
  public manageClient(
    client: { connect: () => any; disconnect?: () => any } | MosaicClient,
  ) {
    if ('connect' in client && typeof client.connect === 'function') {
      const cleanup = (client as any).connect();
      if (typeof cleanup === 'function') {
        this.register(cleanup);
      } else if (
        'disconnect' in client &&
        typeof client.disconnect === 'function'
      ) {
        this.register(() => (client as any).disconnect());
      }
    }
  }

  /**
   * Returns column metadata (SQL mapping) independent of UI rendering.
   */
  public getColumnMeta(
    columnId: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] {
    if (this._config.columnMeta) {
      return this._config.columnMeta[columnId];
    }
    return undefined;
  }
}

/**
 * Factory function for creating ViewModels without class extension.
 */
export function createMosaicViewModel<
  T extends MosaicViewModel = MosaicViewModel,
>(coordinator: Coordinator, config: MosaicViewModelConfig<T>): T {
  return new MosaicViewModel(coordinator, config) as T;
}
