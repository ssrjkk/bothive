import { NextResponse } from 'next/server';
import { getCurrentUser } from './auth';
import type { User } from './db';
import { toPositiveNumber, validateSalaryRange } from './validate';

export { toPositiveNumber, validateSalaryRange };

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) return null;
  return user as User;
}

export function unauthorized() {
  return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Потолок тела JSON-запроса в символах: резюме и письма режутся раньше
 * (20 000 символов на поле).
 */
const MAX_JSON_CHARS = 200_000;
/*
 * Грубая страховка чтения в байтах — на порядок выше символьного лимита.
 *
 * Символьный лимит проверяется после декодирования, а до него тело — это
 * байты: кириллица весит вдвое больше символов. Рвать чтение ровно на
 * 200 000 байтах значило бы резать легитимные кириллические тексты
 * (170 000 символов ≈ 340 000 байт). Поэтому поток прерывается на 2 МБ —
 * это защита памяти, а не контракт: контракт — 200 000 символов ниже.
 */
const MAX_JSON_BYTES = 2_000_000;

export async function readJson<T>(request: Request): Promise<{ data?: T; error?: NextResponse }> {
  /*
   * Тело читается потоком с прерыванием, а не целиком.
   *
   * Раньше здесь было `await request.text()` и проверка длины ПОСЛЕ чтения:
   * лимит существовал, но память под тело выделялась до него. Гигабайтный
   * POST упирался в лимит уже после того, как гигабайт лёг в память, — и
   * десяток таких запросов параллельно клали процесс.
   *
   * Три рубежа: заявленная длина из заголовка (дешёвая проверка до чтения),
   * счётчик байт по ходу чтения (заголовок можно занизить или не прислать
   * вовсе при chunked-передаче) и точный символьный лимит после декодирования
   * (контракт: 200 000 символов независимо от языка текста). При превышении
   * чтение отменяется — сокет не висит.
   */
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) {
    return { error: badRequest('Слишком большой запрос') };
  }

  try {
    const reader = request.body?.getReader();
    // Тела может не быть вовсе (POST без body) — это пустой JSON, а не ошибка чтения.
    if (!reader) {
      return { error: badRequest('Некорректный JSON') };
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { error: badRequest('Слишком большой запрос') };
      }
      chunks.push(value);
    }
    const total = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      total.set(c, offset);
      offset += c.byteLength;
    }
    const text = new TextDecoder().decode(total);
    if (text.length > MAX_JSON_CHARS) {
      return { error: badRequest('Слишком большой запрос') };
    }
    const data = JSON.parse(text) as T;
    return { data };
  } catch {
    return { error: badRequest('Некорректный JSON') };
  }
}
