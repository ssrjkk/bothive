export type Result<T, E = Error> = Ok<T, E> | Err<T, E>;

export class Ok<T, E = Error> {
  readonly value: T;
  readonly isOk = true as const;
  readonly isErr = false as const;

  constructor(value: T) {
    this.value = value;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Ok(fn(this.value));
  }

  mapErr<F>(_fn: (error: E) => F): Result<T, F> {
    return this as unknown as Result<T, F>;
  }

  unwrap(): T {
    return this.value;
  }

  unwrapOr(_default: T): T {
    return this.value;
  }

  getError(): E | undefined {
    return undefined;
  }
}

export class Err<T, E = Error> {
  readonly error: E;
  readonly isOk = false as const;
  readonly isErr = true as const;

  constructor(error: E) {
    this.error = error;
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return this as unknown as Result<U, E>;
  }

  mapErr<F>(fn: (error: E) => F): Result<T, F> {
    return new Err(fn(this.error));
  }

  unwrap(): T {
    throw this.error instanceof Error ? this.error : new Error(String(this.error));
  }

  unwrapOr(defaultValue: T): T {
    return defaultValue;
  }

  getError(): E | undefined {
    return this.error;
  }
}

export function ok<T, E = AppError>(value: T): Result<T, E> {
  return new Ok(value);
}

export function err<T, E = AppError>(error: E): Result<T, E> {
  return new Err(error);
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(message, 'BAD_REQUEST', 400, details);
  }

  static notFound(message: string): AppError {
    return new AppError(message, 'NOT_FOUND', 404);
  }

  static unauthorized(message: string = 'Unauthorized'): AppError {
    return new AppError(message, 'UNAUTHORIZED', 401);
  }

  static conflict(message: string): AppError {
    return new AppError(message, 'CONFLICT', 409);
  }

  static validation(details: Record<string, unknown>): AppError {
    return new AppError('Validation failed', 'VALIDATION_ERROR', 422, details);
  }

  static internal(message: string = 'Internal error'): AppError {
    return new AppError(message, 'INTERNAL_ERROR', 500);
  }

  toJSON() {
    return {
      error: this.statusCode,
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}
