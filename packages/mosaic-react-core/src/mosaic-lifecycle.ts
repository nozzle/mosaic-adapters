/**
 * A generic lifecycle manager for Mosaic sessions.
 * Handles connecting/disconnecting listeners, bridges, and clients
 * in a framework-agnostic way suitable for React View Models.
 */

import type { Coordinator, MosaicClient, Selection } from '@uwdata/mosaic-core';

export interface MosaicLifecycleOptions {
  coordinator: Coordinator;
  /**
   * Callback to setup selection topology and listeners.
   * Called when the model connects.
   */
  onConnect?: (instance: MosaicLifecycle) => void;
}

export class MosaicLifecycle {
  public coordinator: Coordinator;
  protected options: MosaicLifecycleOptions;

  // Store unsubscribe functions for cleanup (listeners, bridges, etc)
  private _disposables: Array<() => void> = [];

  constructor(optionsOrCoordinator: MosaicLifecycleOptions | Coordinator) {
    if ('coordinator' in optionsOrCoordinator) {
      this.options = optionsOrCoordinator;
      this.coordinator = optionsOrCoordinator.coordinator;
    } else {
      this.coordinator = optionsOrCoordinator;
      this.options = { coordinator: optionsOrCoordinator };
    }
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
   * Helper: Connect a child MosaicClient (like a FacetMenu that exists only in logic)
   * and ensure it disconnects when the model dies.
   */
  public manageClient(
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
   * Setup topology. Can be overridden by subclasses or handled via `onConnect` callback.
   */
  protected setupTopology(): void {
    // Default no-op
  }
}
