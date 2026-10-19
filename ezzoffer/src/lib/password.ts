import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Обёртка над callback-API scrypt.
 *
 * promisify(scrypt) здесь не подходит: перегрузка scrypt с опциями имеет
 * другую сигнатуру, и типы у promisify схлопываются до (password, salt, keylen),
 * из-за чего четвёртый аргумент options не проходит проверку типов. Пишем
 * промис явно — так сигнатура и таймаут остаются под контролем.
 */
function scryptAsync(
  password: string,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Явная перегрузка: встроенные типы scrypt принимают соль только как
    // BinaryLike/Object, хотя runtime допускает строку. Legacy-хеши требуют
    // именно строковой соли, поэтому узкое приведение типов здесь необходимо.
    const fn = scrypt as unknown as (
      p: string,
      s: string | Buffer,
      k: number,
      o: { N: number; r: number; p: number; maxmem: number },
      cb: (err: Error | null, key: Buffer) => void,
    ) => void;
    fn(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/**
 * Хеширование паролей на scrypt.
 *
 * Параметры стоимости вынесены в константы и пишутся в хеш вместе с солью:
 * формат `scrypt$N$r$p$<salt>$<hash>`. Прежний формат `salt:hash` не хранил
 * параметры, поэтому повысить стоимость в будущем было невозможно: пришлось бы
 * ломать совместимость со всеми существующими паролями. Теперь старый формат
 * по-прежнему читается (verifyPassword понимает оба), но новые пароли всегда
 * получают актуальные параметры — старые перехешируются при следующем входе.
 */

/** N=2^16 — 256 МБ? Нет: 128*N*r = 128*65536*8 = 64 МБ памяти на хеш. */
const SCRYPT_N = 65_536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

/**
 * maxmem обязан покрывать 128*N*r + служебный объём. Без него Node бросает
 * "memory limit exceeded" на N=65536, потому что дефолт (32 МБ) меньше
 * требуемых ~64 МБ, и хеширование падало бы на каждом новом пароле.
 */
const MAX_MEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export type ScryptParams = { N: number; r: number; p: number };

/** Параметры по умолчанию — самые актуальные для новых хешей. */
export const CURRENT_PARAMS: ScryptParams = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P };

/**
 * Параметры старого формата `salt:hash`. Раньше scrypt вызывался без
 * явных N/r/p, поэтому Node применял дефолтные N=16384, r=8, p=1.
 */
const LEGACY_PARAMS: ScryptParams = { N: 16_384, r: 8, p: 1 };

function derive(
  password: string,
  salt: string | Buffer,
  { N, r, p }: ScryptParams,
): Promise<Buffer> {
  return scryptAsync(normalizePassword(password), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: MAX_MEM,
  });
}

/**
 * Нормализация пароля. NFKC приводит разные виды похожих символов (например,
 * «e» и «е», NFKC-эквивалентные формы) к одному виду, иначе визуально
 * одинаковый пароль давал бы разные хеши.
 *
 * Применяется в `derive` — то есть ровно один раз на путь, и при записи, и при
 * проверке. Отдельные вызовы в `hashPassword` и `verifyPassword` были бы
 * дублированием: `derive` всё равно нормализует, и два места, где об этом надо
 * помнить, вместо одного, — это два места, где можно забыть.
 *
 * Старые хеши (без нормализации) проверяются как есть: их форма здесь уже не
 * изменится. Это осознанный компромисс в пользу совместимости.
 */
export function normalizePassword(password: string): string {
  return password.normalize('NFKC');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, CURRENT_PARAMS);
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/** Разбор сохранённого хеша в параметры, соль и ожидаемый дайджест. */
function parseStored(
  stored: string,
): { params: ScryptParams; salt: string | Buffer; hash: Buffer } | null {
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 6) return null;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
    // Защита от DoS через подделанный хеш: absurd-параметры в значении из БД
    // заставили бы процесс выделить гигабайты памяти на каждой проверке.
    if (N > 1_048_576 || r > 32 || p > 16) return null;
    if (N < 2 || r < 1 || p < 1) return null;
    const salt = Buffer.from(parts[4]!, 'hex');
    if (salt.length !== SALT_LENGTH) return null;
    return { params: { N, r, p }, salt, hash: Buffer.from(parts[5]!, 'hex') };
  }

  // Legacy: `salt:hash`. Соль здесь — именно hex-строка, а не декодированные
  // байты: старый код делал scryptSync(password, salt, 64), где salt уже был
  // строкой. Декодирование здесь дало бы другую соль и сломало бы проверку
  // всех паролей, созданных до перехода на версионированный формат.
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return null;
  return { params: LEGACY_PARAMS, salt, hash: Buffer.from(hash, 'hex') };
}

/**
 * Проверка пароля. Возвращает true только при полном совпадении.
 *
 * Сравнение всегда идёт через timingSafeEqual, а длины сравниваются заранее:
 * timingSafeEqual бросает исключение на разной длине, и сама эта ошибка стала бы
 * побочным каналом. Для неизвестного формата возвращается фиктивное сравнение,
 * чтобы время ответа не зависело от того, существует ли такой хеш.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseStored(stored);
  if (!parsed || parsed.hash.length !== KEY_LENGTH) {
    await derive(password, Buffer.alloc(SALT_LENGTH), CURRENT_PARAMS);
    return false;
  }
  const candidate = await derive(password, parsed.salt, parsed.params);
  return timingSafeEqual(candidate, parsed.hash);
}

/**
 * Нужен ли пересчёт хеша: пароль верный, но сохранён он со старыми
 * (более дешёвыми) параметрами. Вызывающий код перезаписывает хеш новым.
 */
export function needsRehash(stored: string): boolean {
  const parsed = parseStored(stored);
  if (!parsed) return true;
  const { N, r, p } = parsed.params;
  return N < SCRYPT_N || r < SCRYPT_R || p < SCRYPT_P;
}

/** Длина хеша, ожидаемая от scrypt. */
export const HASH_LENGTH = KEY_LENGTH;
