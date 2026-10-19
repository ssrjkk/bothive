/**
 * Идентификатор из адреса.
 *
 * Проверка идёт по форме, а не через Number: Number разбирает «1e3», «0x10»,
 * « 1 » и «1.0» и возвращает целое, поэтому проверка «isInteger && > 0» их
 * принимала. Идентификатор приходит из URL, и «/api/applications/1e3» должен
 * быть отказом, а не откликом № 1000.
 *
 * Всё, что не является обычной десятичной записью без нуля на конце, отклоняется.
 */
const PLAIN_POSITIVE_ID = /^[1-9]\d*$/;

export function parseParamId(value: string | undefined): number | null {
  if (typeof value !== 'string') return null;
  if (!PLAIN_POSITIVE_ID.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}

export function toPositiveNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function validateSalaryRange(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null && min > max) {
    return 'Минимальная зарплата не может быть больше максимальной';
  }
  return null;
}
