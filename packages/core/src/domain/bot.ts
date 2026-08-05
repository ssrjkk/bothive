import { BotState, BotTransition, BotStateMachine } from '../state-machine/bot-state.js';
import { Result, ok, err, AppError } from '../errors/result.js';
import { stripControlChars } from '../utils/sanitize.js';

export type Platform = 'telegram' | 'twitch' | 'youtube' | 'twitter';

export interface BotCredentials {
  token?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  apiKey?: string;
  username?: string;
  channel?: string;
  channelId?: string;
}

export interface BotConfig {
  pollingInterval?: number;
  dailyLimit?: number;
  workHours?: { start: string; end: string };
  webhookUrl?: string;
  rateLimitPerMinute?: number;
}

export interface BotSnapshot {
  id: string;
  name: string;
  platform: Platform;
  state: BotState;
  credentials: BotCredentials;
  config: BotConfig;
  accountId: string;
  createdAt: Date;
  updatedAt: Date;
  lastError?: string;
  connectedAt?: Date;
}

export class Bot {
  private readonly _id: string;
  private _name: string;
  private readonly _platform: Platform;
  private _credentials: BotCredentials;
  private _config: BotConfig;
  private _accountId: string;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _lastError?: string;
  private _connectedAt?: Date;
  private readonly _stateMachine: BotStateMachine;

  private constructor(snapshot: BotSnapshot) {
    this._id = snapshot.id;
    this._name = snapshot.name;
    this._platform = snapshot.platform;
    this._credentials = { ...snapshot.credentials };
    this._config = { ...snapshot.config };
    this._accountId = snapshot.accountId;
    this._createdAt = snapshot.createdAt;
    this._updatedAt = snapshot.updatedAt;
    this._lastError = snapshot.lastError;
    this._connectedAt = snapshot.connectedAt;
    this._stateMachine = new BotStateMachine(snapshot.state);
  }

  static create(props: {
    id: string;
    name: string;
    platform: Platform;
    credentials?: BotCredentials;
    config?: BotConfig;
    accountId: string;
  }): Bot {
    return new Bot({
      id: props.id,
      name: props.name,
      platform: props.platform,
      state: BotState.Idle,
      credentials: props.credentials ?? {},
      config: props.config ?? {},
      accountId: props.accountId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static fromSnapshot(snapshot: BotSnapshot): Bot {
    return new Bot(snapshot);
  }

  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get platform(): Platform { return this._platform; }
  get credentials(): BotCredentials { return { ...this._credentials }; }
  get config(): BotConfig { return { ...this._config }; }
  get accountId(): string { return this._accountId; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get state(): BotState { return this._stateMachine.currentState; }
  get lastError(): string | undefined { return this._lastError; }
  get connectedAt(): Date | undefined { return this._connectedAt; }
  get stateMachine(): BotStateMachine { return this._stateMachine; }

  can(action: BotTransition): boolean {
    return this._stateMachine.can(action);
  }

  async start(): Promise<Result<void, AppError>> {
    if (!this._stateMachine.can(BotTransition.Start)) {
      return err(AppError.badRequest(`Cannot start bot in state ${this.state}`));
    }
    try {
      await this._stateMachine.dispatch(BotTransition.Start);
      this._updatedAt = new Date();
      return ok(undefined);
    } catch (e) {
      return err(AppError.internal(`Start failed: ${e}`));
    }
  }

  async stop(): Promise<Result<void, AppError>> {
    if (!this._stateMachine.can(BotTransition.Stop)) {
      return err(AppError.badRequest(`Cannot stop bot in state ${this.state}`));
    }
    try {
      await this._stateMachine.dispatch(BotTransition.Stop);
      this._connectedAt = undefined;
      this._updatedAt = new Date();
      return ok(undefined);
    } catch (e) {
      return err(AppError.internal(`Stop failed: ${e}`));
    }
  }

  async onConnected(): Promise<void> {
    try {
      await this._stateMachine.dispatch(BotTransition.Connect);
    } catch (e) {
      // state-machine.dispatch already isolates per-listener errors; this is a
      // belt-and-braces guard so a failing connect never becomes unhandled.
      console.error(`[Bot ${this._id}] connect dispatch failed:`, e);
    }
    this._connectedAt = new Date();
    this._lastError = undefined;
    this._updatedAt = new Date();
  }

  async onError(error: string): Promise<void> {
    this._lastError = sanitizeErrorMessage(error);
    this._updatedAt = new Date();
    if (this._stateMachine.can(BotTransition.Fail)) {
      await this._stateMachine.dispatch(BotTransition.Fail);
    }
  }

  async onReconnect(): Promise<void> {
    if (this._stateMachine.can(BotTransition.Reconnect)) {
      await this._stateMachine.dispatch(BotTransition.Reconnect);
      this._updatedAt = new Date();
    }
  }

  updateConfig(config: Partial<BotConfig>): void {
    this._config = { ...this._config, ...config };
    this._updatedAt = new Date();
  }

  updateCredentials(credentials: Partial<BotCredentials>): void {
    this._credentials = { ...this._credentials, ...credentials };
    this._updatedAt = new Date();
  }

  rename(name: string): void {
    this._name = name;
    this._updatedAt = new Date();
  }

  snapshot(): BotSnapshot {
    return {
      id: this._id,
      name: this._name,
      platform: this._platform,
      state: this.state,
      credentials: { ...this._credentials },
      config: { ...this._config },
      accountId: this._accountId,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      lastError: this._lastError,
      connectedAt: this._connectedAt,
    };
  }

  isOnline(): boolean {
    return this.state === BotState.Running;
  }

  isOffline(): boolean {
    return this.state === BotState.Idle || this.state === BotState.Error || this.state === BotState.Removed;
  }
}

const MAX_ERROR_LENGTH = 500;

/** Strips control characters and caps the length of error text before it is stored/persisted. */
function sanitizeErrorMessage(message: string): string {
  return stripControlChars(message).trim().slice(0, MAX_ERROR_LENGTH);
}
