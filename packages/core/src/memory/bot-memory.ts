export interface MemoryEntry<T = unknown> {
  key: string;
  value: T;
  ttl?: number;
  createdAt: Date;
  expiresAt?: Date;
}

export interface ConversationContext {
  chatId: string | number;
  userId?: string | number;
  state: string;
  data: Record<string, unknown>;
  history: Array<{ role: 'user' | 'bot'; message: string; timestamp: Date }>;
  updatedAt: Date;
}

export interface UserProfile {
  id: string | number;
  username?: string;
  firstName?: string;
  lastName?: string;
  language?: string;
  platform: string;
  firstSeen: Date;
  lastSeen: Date;
  interactionCount: number;
  metadata: Record<string, unknown>;
}

export interface BotMemoryStore {
  get<T>(botId: string, key: string): Promise<MemoryEntry<T> | undefined>;
  set<T>(botId: string, key: string, value: T, ttl?: number): Promise<void>;
  delete(botId: string, key: string): Promise<void>;
  clear(botId: string): Promise<void>;
  getAll<T>(botId: string): Promise<MemoryEntry<T>[]>;
  increment(botId: string, key: string, by?: number): Promise<number>;
}

export class BotMemory {
  private store: BotMemoryStore;

  constructor(store: BotMemoryStore) {
    this.store = store;
  }

  async remember<T>(botId: string, key: string, value: T, ttl?: number): Promise<void> {
    await this.store.set(botId, `mem:${key}`, value, ttl);
  }

  async recall<T>(botId: string, key: string): Promise<T | undefined> {
    const entry = await this.store.get<T>(botId, `mem:${key}`);
    return entry?.value;
  }

  async forget(botId: string, key: string): Promise<void> {
    await this.store.delete(botId, `mem:${key}`);
  }

  async count(botId: string, counter: string, by: number = 1): Promise<number> {
    return this.store.increment(botId, `cnt:${counter}`, by);
  }

  async getCount(botId: string, counter: string): Promise<number> {
    const entry = await this.store.get<number>(botId, `cnt:${counter}`);
    return entry?.value ?? 0;
  }

  async setConversationContext(botId: string, chatId: string | number, ctx: Partial<ConversationContext>): Promise<void> {
    const key = `conv:${chatId}`;
    const existing = await this.store.get<ConversationContext>(botId, key);
    const merged: ConversationContext = {
      chatId,
      state: ctx.state ?? existing?.value.state ?? 'start',
      data: { ...existing?.value.data, ...ctx.data },
      history: existing?.value.history ?? [],
      updatedAt: new Date(),
      ...ctx,
    };
    await this.store.set(botId, key, merged, 86400);
  }

  async getConversationContext(botId: string, chatId: string | number): Promise<ConversationContext | undefined> {
    const entry = await this.store.get<ConversationContext>(botId, `conv:${chatId}`);
    return entry?.value;
  }

  async addConversationMessage(
    botId: string,
    chatId: string | number,
    role: 'user' | 'bot',
    message: string,
  ): Promise<void> {
    const key = `conv:${chatId}`;
    const entry = await this.store.get<ConversationContext>(botId, key);
    const ctx = entry?.value ?? {
      chatId,
      state: 'start',
      data: {},
      history: [],
      updatedAt: new Date(),
    };

    ctx.history.push({ role, message, timestamp: new Date() });
    if (ctx.history.length > 50) {
      ctx.history = ctx.history.slice(-50);
    }
    ctx.updatedAt = new Date();

    await this.store.set(botId, key, ctx, 86400);
  }

  async trackUser(botId: string, user: UserProfile): Promise<void> {
    const key = `user:${user.id}`;
    const existing = await this.store.get<UserProfile>(botId, key);

    const merged: UserProfile = {
      ...(existing?.value ?? user),
      ...user,
      firstSeen: existing?.value.firstSeen ?? user.firstSeen,
      lastSeen: new Date(),
      interactionCount: (existing?.value.interactionCount ?? 0) + 1,
      metadata: { ...existing?.value.metadata, ...user.metadata },
    };

    await this.store.set(botId, key, merged, 604800); // 7 days
  }

  async getUser(botId: string, userId: string | number): Promise<UserProfile | undefined> {
    const entry = await this.store.get<UserProfile>(botId, `user:${userId}`);
    return entry?.value;
  }

  async clearAll(botId: string): Promise<void> {
    await this.store.clear(botId);
  }
}
