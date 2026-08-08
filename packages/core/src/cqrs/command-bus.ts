import { Result, AppError, Err } from '../errors/result.js';

export interface Command {
  readonly type: string;
  readonly aggregateId?: string;
}

export interface Query {
  readonly type: string;
}

export interface CommandHandler<TCommand extends Command, TResult> {
  readonly commandType: string;
  handle(command: TCommand): Promise<Result<TResult, AppError>>;
}

export interface QueryHandler<TQuery extends Query, TResult> {
  readonly queryType: string;
  handle(query: TQuery): Promise<Result<TResult, AppError>>;
}

export class CommandBus {
  private handlers = new Map<string, CommandHandler<Command, unknown>>();

  register<TCommand extends Command, TResult>(handler: CommandHandler<TCommand, TResult>): void {
    if (this.handlers.has(handler.commandType)) {
      throw new Error(`Command handler for "${handler.commandType}" already registered`);
    }
    this.handlers.set(handler.commandType, handler);
  }

  async dispatch<TCommand extends Command, TResult>(
    command: TCommand,
  ): Promise<Result<TResult, AppError>> {
    const handler = this.handlers.get(command.type) as
      CommandHandler<TCommand, TResult> | undefined;
    if (!handler) {
      return new Err<TResult, AppError>(
        AppError.internal(`No handler registered for command "${command.type}"`),
      );
    }
    return handler.handle(command);
  }

  get registeredCommands(): string[] {
    return Array.from(this.handlers.keys());
  }
}

export class QueryBus {
  private handlers = new Map<string, QueryHandler<Query, unknown>>();

  register<TQuery extends Query, TResult>(handler: QueryHandler<TQuery, TResult>): void {
    if (this.handlers.has(handler.queryType)) {
      throw new Error(`Query handler for "${handler.queryType}" already registered`);
    }
    this.handlers.set(handler.queryType, handler);
  }

  async ask<TQuery extends Query, TResult>(query: TQuery): Promise<Result<TResult, AppError>> {
    const handler = this.handlers.get(query.type) as QueryHandler<TQuery, TResult> | undefined;
    if (!handler) {
      return new Err<TResult, AppError>(
        AppError.internal(`No handler registered for query "${query.type}"`),
      );
    }
    return handler.handle(query);
  }

  get registeredQueries(): string[] {
    return Array.from(this.handlers.keys());
  }
}

export const commandBus = new CommandBus();
export const queryBus = new QueryBus();
