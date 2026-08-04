import type { Platform, BotCredentials } from './bot.js';

export interface AccountSnapshot {
  id: string;
  name: string;
  platform: Platform;
  credentials: BotCredentials;
  createdAt: Date;
  updatedAt: Date;
}

export class Account {
  private readonly _id: string;
  private _name: string;
  private readonly _platform: Platform;
  private _credentials: BotCredentials;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  private constructor(snapshot: AccountSnapshot) {
    this._id = snapshot.id;
    this._name = snapshot.name;
    this._platform = snapshot.platform;
    this._credentials = { ...snapshot.credentials };
    this._createdAt = snapshot.createdAt;
    this._updatedAt = snapshot.updatedAt;
  }

  static create(props: { id: string; name: string; platform: Platform; credentials?: BotCredentials }): Account {
    return new Account({
      id: props.id,
      name: props.name,
      platform: props.platform,
      credentials: props.credentials ?? {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static fromSnapshot(snapshot: AccountSnapshot): Account {
    return new Account(snapshot);
  }

  get id(): string { return this._id; }
  get name(): string { return this._name; }
  get platform(): Platform { return this._platform; }
  get credentials(): BotCredentials { return { ...this._credentials }; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }

  updateCredentials(credentials: Partial<BotCredentials>): void {
    this._credentials = { ...this._credentials, ...credentials };
    this._updatedAt = new Date();
  }

  rename(name: string): void {
    this._name = name;
    this._updatedAt = new Date();
  }

  snapshot(): AccountSnapshot {
    return {
      id: this._id,
      name: this._name,
      platform: this._platform,
      credentials: this._credentials,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    };
  }
}
