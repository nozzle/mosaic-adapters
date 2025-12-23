/**
 * Base class for View Models that manage Mosaic selections, topology, and schema mapping
 * independent of the UI framework. Provides lifecycle management for listeners and clients.
 */

import type { Coordinator, MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

export interface MosaicViewModelOptions {
  coordinator: Coordinator;
  /**
   * Callback to setup selection topology and listeners.
   * Called when the model connects.
   */
  onConnect?: (model: MosaicViewModel) => void;
  /**
   * Metadata map for columns.
   * Used to resolve `getColumnMeta` calls.
   */
  columnMeta?: Record<
    string,
    MosaicDataTableColumnDefMetaOptions['mosaicDataTable']
  >;
}

export abstract class MosaicViewModel {
  public coordinator: Coordinator;
  private options: MosaicViewModelOptions;

  // Store unsubscribe functions for cleanup (listeners, bridges, etc)
  private _disposables: Array<() => void> = [];

  constructor(optionsOrCoordinator: MosaicViewModelOptions | Coordinator) {
    if ('coordinator' in optionsOrCoordinator) {
      this.options = optionsOrCoordinator;
      this.coordinator = optionsOrCoordinator.coordinator;
    } else {
      this.coordinator = optionsOrCoordinator;
      this.options = { coordinator: optionsOrCoordinator };
    }
  }

  /**
   * Abstract method to clear all selections managed by the dashboard.
   */
  public abstract reset(): void;

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
    // 1. Run Setup Logic
    this.setupTopology();

    // 2. Run Composition Callback (if provided)
    if (this.options.onConnect) {
      this.options.onConnect(this);
    }

    // 3. Return a cleanup function for React/Frameworks to call on unmount
    return () => this.disconnect();
  }

  public disconnect(): void {
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
   * Setup topology. Can be overridden by subclasses.
   */
  protected setupTopology(): void {
    // Default no-op
  }

  /**
   * Returns column metadata (SQL mapping) independent of UI rendering.
   */
  public getColumnMeta(
    columnId: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'] {
    if (this.options.columnMeta) {
      return this.options.columnMeta[columnId];
    }
    return undefined;
  }
}
