import { describe, it, expect } from 'vitest';
import { ok, err, AppError } from '../errors/result.js';

describe('Result pattern', () => {
  it('creates Ok value', () => {
    const r = ok(42);
    expect(r.isOk).toBe(true);
    expect(r.isErr).toBe(false);
    expect(r.unwrap()).toBe(42);
  });

  it('creates Err value', () => {
    const r = err(new Error('fail'));
    expect(r.isOk).toBe(false);
    expect(r.isErr).toBe(true);
    expect(() => r.unwrap()).toThrow('fail');
  });

  it('maps Ok value', () => {
    const r = ok(21).map((x) => x * 2);
    expect(r.unwrap()).toBe(42);
  });

  it('skips map on Err', () => {
    const r = err<number>(new Error('error')).map((x) => x * 2);
    expect(r.isErr).toBe(true);
  });

  it('provides default on Err', () => {
    const r = err<number>(new Error('error'));
    expect(r.unwrapOr(0)).toBe(0);
  });
});

describe('AppError', () => {
  it('creates bad request error', () => {
    const e = AppError.badRequest('invalid input');
    expect(e.statusCode).toBe(400);
    expect(e.code).toBe('BAD_REQUEST');
  });

  it('creates not found error', () => {
    const e = AppError.notFound('bot not found');
    expect(e.statusCode).toBe(404);
    expect(e.code).toBe('NOT_FOUND');
  });

  it('creates validation error with details', () => {
    const e = AppError.validation({ field: 'name', message: 'required' });
    expect(e.statusCode).toBe(422);
    expect(e.code).toBe('VALIDATION_ERROR');
    expect(e.details).toEqual({ field: 'name', message: 'required' });
  });

  it('serializes to JSON', () => {
    const e = AppError.badRequest('bad');
    expect(e.toJSON()).toEqual({
      error: 400,
      code: 'BAD_REQUEST',
      message: 'bad',
    });
  });
});
