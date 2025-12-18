/**
 * Base class for View Models that manage Mosaic selections, topology, and schema mapping
 * independent of the UI framework. Provides lifecycle management for listeners and clients.
 */

import type { Coordinator, MosaicClient, Selection } from '@uwdata/mosaic-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

export abstract class MosaicViewModel {
  public coordinator: Coordinator;

  // Store unsubscribe functions for cleanup (listeners, bridges, etc)
  private _disposables: Array<() => void> = [];

  constructor(coordinator: Coordinator) {
    this.coordinator = coordinator;
  }

  /**
   * Updates the coordinator reference.
   * Encapsulates mutation to satisfy linting rules when used with useState lazy init.
   */
  public setCoordinator(coordinator: Coordinator) {
    this.coordinator = coordinator;
  }

  /**
   * The entry point. Connects all selections and internal listeners.
   * Call this when the View mounts.
   */
  public connect(): () => void {
    // 1. Setup Topology (Cross-selection logic)
    this.setupTopology();

    // 2. Return a cleanup function for React/Frameworks to call on unmount
    return () => this.disconnect();
  }

  public disconnect(): void {
    // Execute all cleanups in reverse order (LIFO)
    // This is safer for dependent resources
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
   * Useful for Bridges, Timers, or custom subscriptions.
   */
  protected register(cleanup: () => void) {
    this._disposables.push(cleanup);
  }

  /**
   * Helper to add listeners that are automatically cleaned up.
   */
  protected listen(
    selection: Selection,
    event: 'value' | 'active',
    handler: () => void,
  ) {
    selection.addEventListener(event, handler);
    this.register(() => selection.removeEventListener(event, handler));
  }

  /**
   * Helper: Connect a child MosaicClient (like a FacetMenu that exists only in logic)
   * and ensure it disconnects when the model dies.
   */
  protected manageClient(
    client: { connect: () => any; disconnect?: () => any } | MosaicClient,
  ) {
    // Duck-typing check because MosaicClient signatures vary slightly
    if ('connect' in client && typeof client.connect === 'function') {
      const cleanup = (client as any).connect();
      // If connect returns a function (standard Mosaic), use it
      if (typeof cleanup === 'function') {
        this.register(cleanup);
      }
      // If connect returns nothing, look for explicit disconnect
      else if (
        'disconnect' in client &&
        typeof client.disconnect === 'function'
      ) {
        this.register(() => (client as any).disconnect());
      }
    }
  }

  /**
   * Abstract method where subclasses define their specific logic.
   * e.g., "When Input Filter changes, clear Detail Filter".
   */
  protected abstract setupTopology(): void;

  /**
   * Returns column metadata (SQL mapping) independent of UI rendering.
   * Used to keep SQL logic out of View components.
   */
  public abstract getColumnMeta(
    columnId: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'];
}
