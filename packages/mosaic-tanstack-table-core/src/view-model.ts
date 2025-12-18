/**
 * Base class for View Models that manage Mosaic selections, topology, and schema mapping
 * independent of the UI framework.
 */

import type { Coordinator, Selection } from '@uwdata/mosaic-core';
import type { MosaicDataTableColumnDefMetaOptions } from './types';

export abstract class MosaicViewModel {
  public coordinator: Coordinator;
  public abstract selections: Record<string, Selection>;

  // Store unsubscribe functions for cleanup
  private _listeners: Array<() => void> = [];

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
    this._listeners.forEach((unsub) => unsub());
    this._listeners = [];
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
    this._listeners.push(() => selection.removeEventListener(event, handler));
  }

  /**
   * Abstract method where subclasses define their specific logic.
   * e.g., "When Input Filter changes, clear Detail Filter".
   */
  protected abstract setupTopology(): void;

  /**
   * Returns column metadata (SQL mapping) independent of UI rendering.
   */
  public abstract getColumnMeta(
    columnId: string,
  ): MosaicDataTableColumnDefMetaOptions['mosaicDataTable'];
}
