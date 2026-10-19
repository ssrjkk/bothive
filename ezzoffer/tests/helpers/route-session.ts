import { mock } from 'node:test';
import type { User } from '../../src/lib/db';

/**
 * Подмена сессии для вызова API-роутов напрямую.
 *
 * Роуты зовут requireUser() → getCurrentUser() → cookies() из next/headers,
 * а cookies() вне request-контекста Next бросает исключение. Поэтому тесты
 * подменяют весь модуль @/lib/auth: сессия становится обычной переменной,
 * которую можно переключать между кейсами («вошёл» / «не вошёл»).
 *
 * Требуется флаг --experimental-test-module-mocks (прописан в npm-скрипте test).
 *
 * ВАЖНО: импортировать этот модуль нужно ДО импорта роута — mock.module
 * подменяет запись в кэше модулей, и уже загруженный роут останется с
 * исходной версией auth. Роуты в тестах импортируются динамически внутри
 * тестов, поэтому порядок соблюдается автоматически.
 */

export const DUMMY_HASH = `scrypt$65536$8$1$${'0'.repeat(32)}$${'0'.repeat(128)}`;

let currentUser: User | null = null;

export function fakeUser(over: Partial<User> = {}): User {
  return {
    id: 1,
    email: 'route@example.test',
    name: 'Тестовый Пользователь',
    password_hash: DUMMY_HASH,
    created_at: 0,
    plan: 'pro',
    plan_period: 14,
    plan_activated_at: 0,
    plan_expires_at: Date.now() + 24 * 60 * 60 * 1000,
    trial_started_at: 0,
    hh_token: null,
    hh_token_expires_at: null,
    hh_refresh_token: null,
    hh_resume_id: null,
    telegram_chat_id: null,
    autoapply_paused: 0,
    autoapply_blocked_until: 0,
    autoapply_block_reason: '',
    email_verified: 1,
    mode: 'demo',
    email_verification_token: null,
    email_verification_expires: null,
    password_reset_token: null,
    password_reset_expires: null,
    salary_expectation: null,
    city_preference: '',
    ...over,
  };
}

/** «Авторизован» — все следующие вызовы роутов видят этого пользователя. */
export function loginAs(user: Partial<User> = {}): User {
  currentUser = fakeUser(user);
  return currentUser;
}

/** «Не авторизован» — роуты должны отвечать 401. */
export function logout(): void {
  currentUser = null;
}

export function currentSessionUser(): User | null {
  return currentUser;
}

/** Счётчик вызовов verifyPassword — им проверяют порядок операций. */
export const authCalls = {
  hashPassword: 0,
  verifyPassword: 0,
};

mock.module('../../src/lib/auth.ts', {
  exports: {
    getCurrentUser: async (): Promise<User | undefined> => currentUser ?? undefined,
    hashPassword: async (): Promise<string> => {
      authCalls.hashPassword++;
      return DUMMY_HASH;
    },
    verifyPassword: async (): Promise<boolean> => {
      authCalls.verifyPassword++;
      return true;
    },
    needsRehash: (): boolean => false,
    SESSION_COOKIE: 'ez_session',
    isHttpsRequest: (): boolean => false,
    createSession: () => ({ token: 'test-token', expiresAt: Date.now() + 86_400_000 }),
    destroySession: (): void => undefined,
    getSessionUser: (): undefined => undefined,
    rotateSession: (): null => null,
    publicUser: (user: User): Partial<User> => ({
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
      plan_expires_at: user.plan_expires_at,
      trial_started_at: user.trial_started_at,
    }),
    purgeExpiredAuthRows: (): void => undefined,
    resetAuthPurge: (): void => undefined,
  },
});

/** Подготовка окружения для роутов: тихая БД в памяти. */
export function useInMemoryDb(env: Record<string, string | undefined> = {}): void {
  process.env.EZOFFER_DB_PATH = ':memory:';
  process.env.EZOFFER_SILENT = '1';
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Строит POST-запрос с JSON-телом. */
export function post(body: unknown): Request {
  return new Request('http://localhost:3000/api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Строит PATCH/PUT-запрос с JSON-телом. */
export function write(method: 'PATCH' | 'PUT', body: unknown): Request {
  return new Request('http://localhost:3000/api/test', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function readJson<T = { error?: string }>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch {
    return {} as T;
  }
}
