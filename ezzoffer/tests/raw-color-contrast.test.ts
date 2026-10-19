import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Контраст сырых цветов Tailwind, которые остались в разметке.
 *
 * Раньше здесь стоял запрет: «используйте только токены палитры». Запрет
 * оказался неверным решением — он требовал переписать то, что уже работает.
 * Проверка показала, что все оставшиеся связки «текст на подложке своего
 * тона» проходят AA с запасом (8–10:1): лёгкие оттенки (red-300,
 * violet-300, emerald-300) выбраны именно потому, что ими пишут текст
 * на тёмном фоне. Массовая замена на токены ухудшила бы контраст —
 * ровно так случилось с text-slate-400, который был контрастнее muted.
 *
 * Поэтому здесь не запрет, а проверка. Ловится реалистичная регрессия:
 * кто-то поменяет text-red-300 на text-red-600, и текст на подложке
 * своего тона провалится — это молча ломает читаемость.
 */

const CSS = readFileSync('src/app/globals.css', 'utf8');

type Rgb = [number, number, number];

/** Шкала Tailwind, ограниченная оттенками, реально встречающимися в проекте. */
const TAILWIND: Record<string, Record<number, string>> = {
  red: { 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626' },
  amber: { 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b' },
  emerald: { 300: '#6ee7b7', 400: '#34d399', 500: '#10b981' },
  violet: { 300: '#d8b4fe', 400: '#c4b5fd', 500: '#8b5cf6', 600: '#7c3aed' },
  pink: { 400: '#f472b6', 500: '#ec4899' },
  cyan: { 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4' },
  green: { 300: '#86efac', 400: '#4ade80', 500: '#22c55e' },
  blue: { 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6' },
  yellow: { 300: '#fde047', 400: '#facc15' },
  indigo: { 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1' },
  purple: { 300: '#d8b4fe', 400: '#c084fc', 500: '#a855f7' },
};

function rgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}
function luminance(hex: string): number {
  const lin = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
/** Подложка = цвет тона при alpha поверх тёмной поверхности. */
function tint(colorHex: string, alpha: number, over: string): string {
  const fg = rgb(colorHex);
  const bg = rgb(over);
  return `#${fg
    .map((c, i) =>
      Math.round(c * alpha + bg[i]! * (1 - alpha))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/**
 * Поверхности читаются из globals.css, а не заданы константами.
 *
 * Регрессия самого теста: здесь раньше стояли жёсткие #12121a и #0a0a0f —
 * цвета тёмной темы. После перехода на бумагу они остались в коде теста,
 * и он продолжал рапортовать «всё в порядке», пока реальный text-red-400
 * на бумаге давал 2.3:1. Тест, считающий не по той теме, что в проде,
 * хуже отсутствия теста: он даёт ложную уверенность.
 */
function cssVar(name: string): string {
  const re = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'g');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) last = m[1]!;
  assert.ok(last, `переменная --color-${name} не найдена в globals.css`);
  return last;
}

const SURFACE = cssVar('surface');
const BG = cssVar('bg');

/**
 * Все исходники на диске.
 *
 * Список из `git ls-files src` содержал удалённые файлы — индекс обновляется
 * только при явном `git rm` — и проверки падали с ENOENT на файле, которого
 * на диске уже нет. Заодно новые файлы в индекс не попадали и не проверялись.
 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
  };
  walk(join(process.cwd(), 'src'));
  return out.sort();
}

test('подложки в тесте совпадают с темой', () => {
  // Если тест считает по цветам другой темы, он будет зелёным на бумаге —
  // ровно то, что случилось при переходе.
  assert.notEqual(SURFACE, '#12121a', 'тест всё ещё считает по тёмной теме');
  assert.notEqual(BG, '#0a0a0f', 'тест всё ещё считает по тёмной теме');
});

test('текст на подложке сырого тона проходит AA', () => {
  const failures: string[] = [];
  const pairs: string[] = [];

  for (const file of sourceFiles()) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/"([^"]*\b(?:bg|text)-[a-z]+-\d{3}[^"]*)"/g)) {
      const cls = m[1]!;
      for (const tintMatch of cls.matchAll(/\bbg-([a-z]+)-(\d{3})\/(\d{1,3})\b/g)) {
        const [, hue, bgShade, alphaStr] = tintMatch;
        const bgColor = TAILWIND[hue!]?.[Number(bgShade)];
        if (!bgColor) continue;
        for (const textMatch of cls.matchAll(/\btext-([a-z]+)-(\d{3})\b/g)) {
          const fg = TAILWIND[textMatch[1]!]?.[Number(textMatch[2])];
          if (!fg) continue;
          const where = `text-${textMatch[1]}-${textMatch[2]} на bg-${hue}-${bgShade}/${alphaStr}`;
          pairs.push(`${file}: ${where}`);
          const background = tint(bgColor, Number(alphaStr) / 100, SURFACE);
          const r = contrast(fg, background);
          if (r < 4.5) {
            failures.push(`${file}: ${where} (${background}) = ${r.toFixed(2)}:1 — нужно 4.5:1`);
          }
        }
      }
    }
  }

  assert.deepEqual(failures, [], `контраст ниже AA:\n${failures.join('\n')}`);
  /*
   * Светлые оттенки шкалы (red-300, violet-300) рассчитаны на тёмный фон:
   * на бумаге они дают 1.3–1.7:1 и почти не видны. Вся окраска идёт через
   * токены палитры, поэтому сырых пар в разметке быть не должно вовсе.
   */
  assert.deepEqual(
    pairs,
    [],
    `сырые оттенки в тексте — на бумаге не видны, берите токены:\n${pairs.join('\n')}`,
  );
});

test('светлый текст на тёмном фоне проходит AA', () => {
  // Случай без подложки своего тона: цвет просто на фоне страницы или карточки.
  const failures: string[] = [];
  const raw: string[] = [];

  for (const file of sourceFiles()) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/"([^"]*\btext-[a-z]+-\d{3}[^"]*)"/g)) {
      const cls = m[1]!;
      // Подложка того же тона разбирается отдельно, выше.
      if (/\bbg-[a-z]+-\d{3}\/\d{1,3}\b/.test(cls)) continue;
      for (const t of cls.matchAll(/\btext-([a-z]+)-(\d{3})\b/g)) {
        const fg = TAILWIND[t[1]!]?.[Number(t[2])];
        if (!fg) continue;
        raw.push(`${file}: text-${t[1]}-${t[2]}`);
        for (const [name, bg] of [
          ['страница', BG],
          ['карточка', SURFACE],
        ] as const) {
          const r = contrast(fg, bg);
          if (r < 4.5) {
            failures.push(
              `${file}: text-${t[1]}-${t[2]} на фоне «${name}» (${bg}) = ${r.toFixed(2)}:1`,
            );
          }
        }
      }
    }
  }

  assert.deepEqual(failures, [], `контраст ниже AA:\n${failures.join('\n')}`);
  // Раз оттенков не осталось, цвет берётся только из палитры — это и есть
  // требование: пустой список означает «всё переведено на токены».
  assert.deepEqual(raw, [], `сырые текстовые оттенки вместо токенов:\n${raw.join('\n')}`);
});
