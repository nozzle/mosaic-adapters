import {
  MosaicClient,
  coordinator as defaultCoordinator,
} from '@uwdata/mosaic-core';
import { logger } from './logger';
import type { Coordinator, Selection } from '@uwdata/mosaic-core';

/**
 * Abstract base class for Mosaic Clients that need to query the database.
 * Handles:
 * - Connection lifecycle (connect/disconnect)
 * - Coordinator management (swapping)
 * - Safe query execution checks
 * - Standardized error logging
 */
export abstract class BaseMosaicClient extends MosaicClient {
  protected isConnected = false;

  constructor(filterBy?: Selection, coordinator?: Coordinator) {
    super(filterBy);
    this.coordinator = coordinator || defaultCoordinator();
  }

  /**
   * Safely updates the coordinator.
   * If connected, reconnects to the new coordinator.
   */
  setCoordinator(coordinator: Coordinator) {
    if (this.coordinator === coordinator) {
      return;
    }

    const wasConnected = this.isConnected;

    if (wasConnected) {
      this.disconnect();
    }

    this.coordinator = coordinator;

    if (wasConnected) {
      this.connect();
    }
  }

  connect(): () => void {
    if (this.isConnected) {
      return () => {};
    }

    if (!this.coordinator) {
      logger.warn(
        'Core',
        `[${this.constructor.name}] No coordinator available. Cannot connect.`,
      );
      return () => {};
    }

    this.coordinator.connect(this);
    this.isConnected = true;
    this.__onConnect();

    return () => this.disconnect();
  }

  disconnect() {
    this.coordinator?.disconnect(this);
    this.isConnected = false;
    this.__onDisconnect();
  }

  /**
   * Safe wrapper for requestQuery.
   * Returns a resolved promise if no coordinator is present, preventing crashes.
   */
  override requestQuery(query?: any): Promise<any> | null {
    if (!this.coordinator) {
      return Promise.resolve();
    }
    return super.requestQuery(query);
  }

  override queryError(error: Error): this {
    logger.error('Core', `[${this.constructor.name}] Query Error`, { error });
    return this;
  }

  /**
   * Hook called after successful connection.
   */
  protected __onConnect() {}

  /**
   * Hook called after disconnection.
   */
  protected __onDisconnect() {}
}
