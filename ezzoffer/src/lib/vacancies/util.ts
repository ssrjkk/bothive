export function sanitizeExternalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') return trimmed;
  } catch {
    /* невалидный URL */
  }
  return null;
}

export function toSalaryNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[\s\u00A0]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Распаковка MongoDB extended JSON (источники вроде GeekJob отдают числа
 * как {"$numberLong":"..."} / {"$date":{"$numberLong":"..."}}).
 */
export function unwrapExtended(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.$numberLong === 'string') return Number(v.$numberLong);
    if (typeof v.$numberInt === 'string') return Number(v.$numberInt);
    if (v.$date && typeof v.$date === 'object') {
      const inner = (v.$date as Record<string, unknown>).$numberLong;
      if (typeof inner === 'string') return Number(inner);
    }
    if (typeof v.$numberDouble === 'string') return Number(v.$numberDouble);
  }
  return value;
}

function numToSalary(v: unknown): number | null {
  const n = toSalaryNumber(v as number | string | null);
  if (n != null) return n;
  if (typeof v === 'string' && /K|k|M/i.test(v)) {
    const m = v.match(/^([\d.\s]+)\s*([KkMm])$/);
    if (m) {
      const base = Number(m[1].replace(/[\s\u00A0]/g, ''));
      if (Number.isFinite(base) && base > 0) {
        return Math.round(base * (/m/i.test(m[2]) ? 1_000_000 : 1_000));
      }
    }
  }
  return null;
}

function formatN(n: number): string {
  return n.toLocaleString('ru-RU').replace(/\u00A0/g, ' ');
}

const CURRENCY_TABLE: Array<[RegExp, string]> = [
  [/\$|USD/i, '$'],
  [/€|EUR/i, '€'],
  [/£|GBP/i, '£'],
  [/zł|PLN/i, 'zł'],
  [/₺|TRY/i, '₺'],
  [/₸|KZT/i, '₸'],
];

/** Определение символа валюты по тексту зарплаты (например, «1 800-2 500 $»). */
function detectCurrency(raw: string, fallback: string): string {
  for (const [re, symbol] of CURRENCY_TABLE) {
    if (re.test(raw)) return symbol;
  }
  return fallback;
}

/**
 * Парсинг свободной строки зарплаты вида «200K — 230K ₽» или «от 100 000 ₽».
 */
export function parseSalaryText(
  text: string | null | undefined,
  currencySymbol = '₽',
): { display: string; min: number | null; max: number | null } {
  const raw = (text ?? '').trim().replace(/\u00A0/g, ' ');
  if (!raw) return { display: 'по договорённости', min: null, max: null };
  const symbol = detectCurrency(raw, currencySymbol);
  const nums = raw.match(/([\d]+(?:\s[\d]{3})*(?:\.[\d]+)?)\s*([KkMm])?/g) ?? [];
  const values: number[] = [];
  for (const part of nums) {
    const n = numToSalary(part.replace(/\s/g, ''));
    if (n != null) values.push(n);
  }
  const deduped = [...new Set(values)];
  if (deduped.length >= 2) {
    const [a, b] = [deduped[0]!, deduped[deduped.length - 1]!];
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return { display: `${formatN(min)}–${formatN(max)} ${symbol}`, min, max };
  }
  if (deduped.length === 1) {
    const n = deduped[0]!;
    const prefix = /(до|up to)/i.test(raw) ? 'до ' : 'от ';
    return {
      display: `${prefix}${formatN(n)} ${symbol}`,
      min: prefix === 'от ' ? n : null,
      max: prefix === 'до ' ? n : null,
    };
  }
  return { display: raw, min: null, max: null };
}

export function cleanHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code) || 63))
    .replace(/\s+/g, ' ')
    .trim();
}
