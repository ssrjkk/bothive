import type { Command, Query } from './command-bus.js';

export class StartBotCommand implements Command {
  readonly type = 'bot.start';
  constructor(
    public readonly botId: string,
    public readonly platform: string,
  ) {}
  get aggregateId(): string {
    return this.botId;
  }
}

export class StopBotCommand implements Command {
  readonly type = 'bot.stop';
  constructor(
    public readonly botId: string,
    public readonly platform: string,
  ) {}
  get aggregateId(): string {
    return this.botId;
  }
}

export class RestartBotCommand implements Command {
  readonly type = 'bot.restart';
  constructor(
    public readonly botId: string,
    public readonly platform: string,
  ) {}
  get aggregateId(): string {
    return this.botId;
  }
}

export class ExecuteBotActionCommand implements Command {
  readonly type = 'bot.execute';
  constructor(
    public readonly botId: string,
    public readonly platform: string,
    public readonly actionType: string,
    public readonly payload: Record<string, unknown>,
  ) {}
  get aggregateId(): string {
    return this.botId;
  }
}

export class CreateBotCommand implements Command {
  readonly type = 'bot.create';
  constructor(
    public readonly name: string,
    public readonly platform: string,
    public readonly accountId: string,
    public readonly config?: Record<string, unknown>,
  ) {}
}

export class DeleteBotCommand implements Command {
  readonly type = 'bot.delete';
  constructor(public readonly botId: string) {}
  get aggregateId(): string {
    return this.botId;
  }
}

export class UpdateBotCommand implements Command {
  readonly type = 'bot.update';
  constructor(
    public readonly botId: string,
    public readonly data: { name?: string; config?: Record<string, unknown> },
  ) {}
  get aggregateId(): string {
    return this.botId;
  }
}

export class GetBotQuery implements Query {
  readonly type = 'bot.get';
  constructor(public readonly botId: string) {}
}

export class ListBotsQuery implements Query {
  readonly type = 'bot.list';
  constructor(public readonly filter?: { platform?: string; status?: string }) {}
}

export class GetBotStatsQuery implements Query {
  readonly type = 'bot.stats';
}
