import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Шифрование секретов на диске.
 *
 * Токены hh.ru лежали в users открытым текстом, и бэкап базы был, по сути,
 * списком чужих аккаунтов: файла копии достаточно, чтобы отправлять отклики
 * от чужого имени. Это закрывает Фазу 1, пункт про I10.
 *
 * Формат: `v1:<iv-base64>:<tag-base64>:<ciphertext-base64>`
 * Префикс версии обязателен: без него нельзя отличить старый открытый текст
 * от нового шифротекста, а значит — нельзя сделать миграцию идемпотентной.
 *
 * Опасность здесь обратная утечке. Если ключ сменился или потерялся, токены
 * перестают читаться, автоотклики молча перестают работать, и человек узнаёт
 * об этом через неделю. Поэтому при неверном ключе бросается явная ошибка с
 * указанием переменной, а НЕ возвращается пустая строка: пустая строка
 * выглядела бы как «токена нет» и автоотклики просто молчали бы.
 */

const PREFIX = 'v1';
const ALGO = 'aes-256-gcm';

export function tokenKeyEnv(): string {
  return process.env.EZOFFER_TOKEN_KEY ?? '';
}

/** Задана ли защита. Пока нет — секреты лежат как раньше, и это заметно. */
export function encryptionEnabled(): boolean {
  return tokenKeyEnv().length > 0;
}

function key(): Buffer {
  const raw = tokenKeyEnv();
  if (!raw) {
    throw new Error(
      'EZOFFER_TOKEN_KEY не задан, а значение зашифровано. Без ключа его не прочитать.',
    );
  }
  // hex или base64 — оба встречаются в коде людей, и молча разбирать
  // «как получится» нельзя: неверная длина дала бы неверный ключ.
  const buf =
    /^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0
      ? Buffer.from(raw, 'hex')
      : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `EZOFFER_TOKEN_KEY должен давать 32 байта (64 hex-символа), получено ${buf.length}`,
    );
  }
  return buf;
}

/** Зашифровать. null и пустая строка остаются собой: шифровать «ничего» незачем. */
export function encryptSecret(value: string | null): string | null {
  if (value === null || value === '') return value;
  // Уже зашифровано: повторное шифрование испортило бы значение. Такое
  // случается при повторной миграции или двойной записи — и должно быть
  // безобидным.
  if (value.startsWith(`${PREFIX}:`)) return value;
  if (!encryptionEnabled()) return value;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

/**
 * Расшифровать.
 *
 * Значение без префикса версии считается открытым текстом: это старые базы,
 * где миграция ещё не прошла. Молча чинить их нельзя — миграция существует
 * именно для этого.
 */
export function decryptSecret(value: string | null): string | null {
  if (value === null || value === '') return value;
  if (!value.startsWith(`${PREFIX}:`)) return value;

  const parts = value.split(':');
  if (parts.length !== 4) {
    throw new Error('Повреждённое зашифрованное значение: неверный формат');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  try {
    const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    /*
     * Ошибка расшифровки означает одно из двух: ключ не тот или значение
     * подменено. Оба случая надо назвать прямо. Молчаливый возврат пустой
     * строки превратил бы поломку ключа в тихий отказ автооткликов.
     */
    throw new Error(
      `Не удалось расшифровать секрет: ${(error as Error).message}. ` +
        'Проверьте EZOFFER_TOKEN_KEY — он должен совпадать с тем, которым шифровали.',
    );
  }
}
