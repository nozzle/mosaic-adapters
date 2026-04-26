import {
  MosaicClient,
  coordinator as defaultCoordinator,
} from '@uwdata/mosaic-core';
import { Store } from '@tanstack/store';
import { createLifecycleManager } from '../client-utils';
import { InputSubscriptionBag } from './subscriptions';
import type { Query } from '@uwdata/mosaic-sql';
import type { Coordinator } from '@uwdata/mosaic-core';
import type { IMosaicClient } from '../types';
import type { BaseInputCoreConfig, InputSubscriptionCleanup } from './types';

export class BaseInputCore<
  TState extends object,
  TConfig extends BaseInputCoreConfig,
>
  extends MosaicClient
  implements IMosaicClient
{
  readonly store: Store<TState>;

  protected config: TConfig;

  #destroyed = false;
  #subscriptions = new InputSubscriptionBag();
  #lifecycle = createLifecycleManager(this);

  constructor(initialState: TState, config: TConfig) {
    super(config.filterBy);
    this.config = config;
    this.store = new Store(initialState);
    this.coordinator = config.coordinator ?? defaultCoordinator();
    this.enabled = config.enabled !== false;
  }

  get isConnected(): boolean {
    return this.#lifecycle.isConnected;
  }

  override get filterBy() {
    return this.config.filterBy;
  }

  getConfig(): TConfig {
    return this.config;
  }

  setCoordinator(coordinator: Coordinator): void {
    const previousCoordinator = this.coordinator;

    this.#lifecycle.handleCoordinatorSwap(
      previousCoordinator,
      coordinator,
      () => {
        this.coordinator = coordinator;
        this.connect();
      },
    );

    this.coordinator = coordinator;
  }

  connect(): () => void {
    if (this.#destroyed) {
      return () => {};
    }

    const coordinator = this.coordinator ?? this.config.coordinator;
    const targetCoordinator = coordinator ?? defaultCoordinator();
    this.coordinator = targetCoordinator;

    return this.#lifecycle.connect(targetCoordinator);
  }

  disconnect(): void {
    this.#lifecycle.disconnect(this.coordinator);
  }

  updateOptions(nextConfig: TConfig): void {
    if (this.#destroyed) {
      return;
    }

    const previousConfig = this.config;
    const previousFilterBy = previousConfig.filterBy;
    const filterByChanged = previousFilterBy !== nextConfig.filterBy;
    const wasConnected = this.isConnected;
    const nextCoordinator =
      nextConfig.coordinator ?? this.coordinator ?? defaultCoordinator();

    if (filterByChanged && wasConnected) {
      this.disconnect();
    }

    this.config = nextConfig;
    this._filterBy = nextConfig.filterBy;
    this.enabled = nextConfig.enabled !== false;
    this.setCoordinator(nextCoordinator);

    if (filterByChanged && wasConnected) {
      this.connect();
    }

    this.onConfigChange(previousConfig);
  }

  setConfig(nextConfig: TConfig): void {
    this.updateOptions(nextConfig);
  }

  override requestQuery(query?: Query): Promise<unknown> | null {
    if (this.config.enabled === false) {
      return Promise.resolve();
    }

    if (!this.coordinator) {
      return Promise.resolve();
    }

    return super.requestQuery(query);
  }

  override destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.disconnect();
    this.#subscriptions.dispose();
    super.destroy();
  }

  public __onConnect(): void {
    this.onConnect();
  }

  public __onDisconnect(): void {
    this.onDisconnect();
  }

  protected onConnect(): void {}

  protected onDisconnect(): void {}

  protected onConfigChange(_previousConfig: TConfig): void {}

  protected addSubscription(cleanup: InputSubscriptionCleanup): void {
    this.#subscriptions.add(cleanup);
  }

  protected disposeSubscriptions(): void {
    this.#subscriptions.dispose();
  }

  protected setState(patch: Partial<TState>): void {
    this.store.setState((previousState) => ({
      ...previousState,
      ...patch,
    }));
  }
}
