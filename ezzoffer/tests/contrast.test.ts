import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Все исходники, а не только отслеживаемые git.
 *
 * Список из `git ls-files src` содержал удалённые файлы (индекс обновляется
 * только при явном `git rm`), и проверка падала с ENOENT на файле, которого
 * на диске уже нет. Заодно новые файлы не проверялись вовсе — ровно тот
 * дефект, что был в heading-hierarchy.
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
/**
 * Контраст палитры (WCAG 2.1).
 *
 * Lighthouse стабильно репортил color-contrast на лендинге, и причины были
 * неочевидны:
 *  - --color-muted #6b6b80 давал 3.80:1 к основному фону (нужно 4.5:1);
 *  - --color-accent #6366f1 давал 4.47:1 с белым текстом на кнопках —
 *    всего на 0.03 ниже порога;
 *  - --color-accent-2 #7c5cff давал 4.45:1 на секции с полупрозрачной
 *    поверхностью (эффективный фон #0d0d13, а не чистый #0a0a0f).
 *
 * Тест считает контраст по формуле WCAG и сверяет его с реальными значениями
 * из globals.css, чтобы случайный «возврат» более тёмного оттенка снова не
 * проскочил незамеченным.
 */

const CSS = readFileSync('src/app/globals.css', 'utf8');

/** Относительная яркость по WCAG. */
function luminance(hex: string): number {
  const h = hex.replace('#', '').trim();
  const rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Читает переменную из @theme. */
function cssVar(name: string): string {
  // Разрешаем дубликаты: в CSS действует последнее объявление.
  const re = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'g');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) last = m[1]!;
  assert.ok(last, `переменная --color-${name} не найдена в globals.css`);
  return last;
}

/** Фон секции: полупрозрачная поверхность в 40% поверх основного фона. */
function blend(front: string, back: string, alpha: number): string {
  const f = front.replace('#', '');
  const b = back.replace('#', '');
  const mix = (i: number): number => {
    const cf = parseInt(f.slice(i, i + 2), 16);
    const cb = parseInt(b.slice(i, i + 2), 16);
    return Math.round(cf * alpha + cb * (1 - alpha));
  };
  return `#${[0, 2, 4].map((i) => mix(i).toString(16).padStart(2, '0')).join('')}`;
}

const AA_TEXT = 4.5;

test('приглушённый текст проходит AA на основном фоне', () => {
  const ratio = contrast(cssVar('muted'), cssVar('bg'));
  assert.ok(
    ratio >= AA_TEXT,
    `--color-muted ${cssVar('muted')} даёт ${ratio.toFixed(2)}:1 — нужно ${AA_TEXT}:1`,
  );
});

test('приглушённый текст проходит AA на секции с полупрозрачной поверхностью', () => {
  const sectionBg = blend(cssVar('surface'), cssVar('bg'), 0.4);
  const ratio = contrast(cssVar('muted'), sectionBg);
  assert.ok(
    ratio >= AA_TEXT,
    `--color-muted даёт ${ratio.toFixed(2)}:1 на ${sectionBg} — нужно ${AA_TEXT}:1`,
  );
});

test('белый текст на акцентной кнопке проходит AA', () => {
  const ratio = contrast('#ffffff', cssVar('accent'));
  assert.ok(
    ratio >= AA_TEXT,
    `белый на --color-accent ${cssVar('accent')} даёт ${ratio.toFixed(2)}:1 — нужно ${AA_TEXT}:1`,
  );
});

test('состояние hover кнопки тоже проходит AA', () => {
  const ratio = contrast('#ffffff', cssVar('accent-hover'));
  assert.ok(
    ratio >= AA_TEXT,
    `белый на hover ${cssVar('accent-hover')} даёт ${ratio.toFixed(2)}:1 — нужно ${AA_TEXT}:1`,
  );
});

/**
 * Кнопка удаления и её наведение.
 *
 * Отдельная проверка, потому что токен danger-hover добавлялся позже всех
 * и без неё остался бы непроверенным: тесты палитры перечисляют лишь те
 * значения, про которые их автор знал. Убеждаемся, что оба состояния
 * существуют и держат порог с белым текстом.
 */
test('кнопка удаления и её наведение проходят AA', () => {
  for (const [name, token] of [
    ['обычное', 'danger'],
    ['наведение', 'danger-hover'],
  ] as const) {
    const ratio = contrast('#ffffff', cssVar(token));
    assert.ok(
      ratio >= AA_TEXT,
      `белый на --color-${token} ${cssVar(token)} даёт ${ratio.toFixed(2)}:1 (${name}) — нужно ${AA_TEXT}:1`,
    );
  }
});

/**
 * Акцент на тёмном фоне.
 *
 * Регрессия, пойманная при переводе «Историй успеха» в инверсную полосу:
 * результат истории («Оффер через 2 недели») был покрашен обычным
 * `--color-accent` и на `bg-ink` давал 2.41:1 — метку было почти не видно.
 *
 * Причина в том, что `--color-accent` рассчитан как ФОН под белый текст
 * (7.1:1 на бумаге). Как цвет текста на тёмном он не годится никогда,
 * поэтому для чернил существует отдельный токен.
 *
 * Проверяются оба: наличие токена и его контраст на чернилах.
 */
test('акцент на чернилах проходит AA', () => {
  const ratio = contrast(cssVar('accent-on-dark'), cssVar('ink'));
  assert.ok(
    ratio >= AA_TEXT,
    `--color-accent-on-dark ${cssVar('accent-on-dark')} даёт ${ratio.toFixed(2)}:1 на чернилах — нужно ${AA_TEXT}:1`,
  );
});

test('обычный акцент на чернилах НЕ проходит — значит токен обязателен', () => {
  /*
   * Обратная проверка. Если бы `--color-accent` вдруг оказался достаточно
   * светлым для чернил, отдельный токен стал бы лишним и две палитры
   * разошлись бы без причины. Тест фиксирует, что различие намеренное.
   */
  const ratio = contrast(cssVar('accent'), cssVar('ink'));
  assert.ok(
    ratio < AA_TEXT,
    `--color-accent ${cssVar('accent')} неожиданно проходит на чернилах (${ratio.toFixed(2)}:1) — ` +
      'лишний токен accent-on-dark, проверьте, нужен ли он',
  );
});

/**
 * На тёмной поверхности — только светлый акцент.
 *
 * Предыдущий тест проверяет палитру, а этот — разметку: тёмная полоса может
 * появиться где угодно (секция, карточка, диалог), и обычный `text-accent`
 * внутри неё даст 2.41:1. Тест палитры этого не увидит: он читает
 * globals.css, а фон задан классом в компоненте.
 *
 * Ищутся два случая: тёмный фон и акцент в одном наборе классов, и тёмный
 * фон у контейнера с акцентом внутри (так оформлены инверсные секции).
 */
test('на тёмном фоне используется светлый акцент', () => {
  const files = sourceFiles();

  const DARK_BG = /\bbg-ink\b|\bbg-black\b/;
  // text-accent-2 и text-accent-on-dark подходят; голый text-accent — нет.
  // Важно: hover: и focus: варианты не считаются — на тёмном фоне их можно
  // и нужно красить в бумагу, а проверять надо БАЗОВЫЙ цвет текста.
  const BAD_ACCENT = /(?<![\w-])(text-accent)(?![\w-])/;

  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');

    // 1. Тёмный фон и БАЗОВЫЙ акцент в одном наборе классов — заведомо плохо.
    for (const m of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const cls = m[1] ?? m[2] ?? '';
      if (!DARK_BG.test(cls)) continue;
      // Убираем варианты с префиксом состояния, остаётся базовый цвет.
      const base = cls.replace(/[a-z-]+:(text|bg)-[^\s]+/g, '');
      if (BAD_ACCENT.test(base)) {
        const line = source.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}  «${cls.slice(0, 90)}»`);
      }
    }

    /*
     * 2. Тёмный фон у контейнера, акцент у вложенного элемента.
     *    Так оформлены инверсные секции: фон на <section>, акцент на <p>.
     *    Окно берётся до закрытия секции, иначе поймало бы соседние блоки.
     */
    for (const m of source.matchAll(/\bbg-ink\b|\bbg-black\b/g)) {
      const win = source.slice(m.index, m.index + 3000);
      const end = win.indexOf('</section>');
      if (end < 0) continue; // не секция — случай 1 уже покрывает вложенность
      const scope = win.slice(0, end);

      for (const a of scope.matchAll(/className="([^"]*)"/g)) {
        const base = a[1]!.replace(/[a-z-]+:(text|bg)-[^\s]+/g, '');
        if (BAD_ACCENT.test(base)) {
          const line = source.slice(0, m.index).split('\n').length;
          offenders.push(`${file}:~${line}  тёмная секция → «${a[1]!.slice(0, 80)}»`);
        }
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `text-accent на тёмном фоне даёт 2.41:1 — нужен accent-on-dark:\n${offenders.join('\n')}`,
  );
});

test('надзаголовки акцентом-2 проходят AA на подложке секции', () => {
  const sectionBg = blend(cssVar('surface'), cssVar('bg'), 0.4);
  const ratio = contrast(cssVar('accent-2'), sectionBg);
  assert.ok(
    ratio >= AA_TEXT,
    `--color-accent-2 ${cssVar('accent-2')} даёт ${ratio.toFixed(2)}:1 на ${sectionBg}`,
  );
});

test('основной текст проходит AAA на фоне', () => {
  const ratio = contrast(cssVar('ink'), cssVar('bg'));
  assert.ok(ratio >= 7, `--color-ink даёт ${ratio.toFixed(2)}:1 — нужно 7:1 (AAA)`);
});

test('в палитре нет дублирующихся переменных', () => {
  // Дубликат --color-accent-2 перекрывал бы исправленное значение старым,
  // и правка контраста молча ничего не меняла бы.
  const seen = new Map<string, number>();
  const re = /--color-([a-z0-9-]+):/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS)) !== null) {
    seen.set(m[1]!, (seen.get(m[1]!) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  assert.deepEqual(dupes, [], `объявлено несколько раз: ${dupes.join(', ')}`);
});

test('в globals.css есть поддержка prefers-reduced-motion', () => {
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
});

/**
 * Регрессия: паттерн «bg-accent/N + text-accent» — цветной текст на подложке
 * своего же цвета. Такой акцент рассчитан на РОЛЬ ФОНА (белый текст на нём
 * даёт 5.22:1), но как цвет текста он проваливается: на bg-accent/15 получалось
 * 3.78:1, и Lighthouse репортил color-contrast на /internships и
 * /resume-examples.
 *
 * Для текста на такой подложке нужен accent-2 (осветлённый): 4.74:1 на
 * bg-accent/15 и 4.48:1 на bg-accent/10. Проверяем, что паттерн не вернулся.
 */
test('цветной текст на подложке своего цвета использует accent-2', () => {
  const files = sourceFiles();

  const offenders: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    // Раньше проверка брала только литерал className="..." сразу после
    // открывающей кавычки, и потому пропускала className={cond ? "a b" : "c"} —
    // именно там прятались два нарушения в кабинете (applications-view,
    // plan-settings). Теперь берём участок между ближайшими кавычками.
    for (const m of content.matchAll(/bg-accent\/[\d.]+/g)) {
      const before = content.lastIndexOf('"', m.index);
      const after = content.indexOf('"', m.index + m[0].length);
      if (before === -1 || after === -1) continue;
      const cls = content.slice(before + 1, after);
      if (/\btext-accent\b/.test(cls) && !/\btext-accent-2\b/.test(cls)) {
        offenders.push(`${file}: ${cls.slice(0, 70)}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `text-accent на подложке bg-accent/* не проходит AA:\n${offenders.join('\n')}`,
  );
});

/**
 * Регрессия: в кабинете текст красили сырыми цветами Tailwind
 * (text-slate-400/500), минуя палитру, которую мы откалибровали под WCAG
 * и закрыли тестами.
 *
 * text-slate-500 (#64748b) давал 3.78–4.15:1 при пороге 4.5 — Lighthouse
 * репортил color-contrast на /dashboard и /dashboard/settings.
 *
 * Сырые цвета опасны именно обходом: контрастные тесты читают globals.css,
 * а эти значения живут в разметке, и проверка их не видит. Тест закрывает щель.
 */
test('нейтральный текст не красится сырыми цветами Tailwind', () => {
  const files = sourceFiles();

  // Проверяем только НЕЙТРАЛЬНУЮ шкалу: она заменяет приглушённый текст,
  // и именно на ней контраст падал ниже порога. Семантические цвета
  // (red/amber/pink в hero и плашках) сознательно оставлены как есть —
  // их перевод в токены меняет дизайн и заслуживает отдельного решения.
  const offenders: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(
      /(?:text|bg|border|ring|fill|stroke|from|via|to|divide|shadow|accent|caret)-(?:slate|gray|zinc|neutral|stone)-[0-9]{2,3}\b/g,
    )) {
      offenders.push(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `нейтральные цвета вне палитры — их контраст ничем не проверяется:\n${offenders.join('\n')}`,
  );
});

/**
 * Цветные шкалы Tailwind.
 *
 * Регрессия из графика статистики: легенда и столбцы красились двумя
 * разными наборами — легенда сырыми violet-500/cyan-400/emerald-400,
 * столбцы токенами темы. Цвет в легенде переставал означать тот цвет,
 * который нарисован, и проверить это было нечем: тесты палитры читают
 * globals.css, а эти значения жили в разметке.
 *
 * Комментарии и строковые литералы исключены из разбора: иначе проверка
 * ловит собственный текст теста — при описании старых значений в
 * комментарии он находил их в том же файле.
 */
test('цветные шкалы Tailwind не используются напрямую', () => {
  const files = sourceFiles();

  const COLOR =
    /(?:text|bg|border|ring|fill|stroke|from|via|to|divide|accent|caret)-(?:violet|indigo|purple|fuchsia|sky|blue|rose|pink|red|orange|amber|emerald|lime|teal)-[0-9]{2,3}\b/g;

  /** Вырезает комментарии и содержимое строк, оставляя только разметку. */
  function markupOnly(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, ' ') // /* … */
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ') // {/* … */} в JSX
      .replace(/\/\/[^\n]*/g, ' ') // // …
      .replace(/"(?:[^"\\]|\\.)*"/g, '""') // "…"
      .replace(/'(?:[^'\\]|\\.)*'/g, "''"); // '…'
  }

  const offenders: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const m of markupOnly(source).matchAll(COLOR)) {
      const line = source.slice(0, m.index).split('\n').length;
      offenders.push(`${file}:${line}  ${m[0]}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `цвет вне палитры — он не участвует в проверках контраста и разошёлся с токеном:\n${offenders.join('\n')}`,
  );
});

/**
 * Приглушённый текст на всех поверхностях темы.
 *
 * Поверхности читаются из globals.css, а не заданы константами: проверка
 * контраста, считающая не по той теме, что в проде, хуже её отсутствия —
 * именно такой тест остался зелёным при переходе на бумагу.
 */
test('приглушённый текст проходит AA на всех поверхностях кабинета', () => {
  const surfaces = [
    ['страница', cssVar('bg')],
    ['карточка', cssVar('surface')],
    ['приподнятая карточка', cssVar('surface-2')],
  ] as const;
  for (const [name, hex] of surfaces) {
    const r = contrast(cssVar('muted'), hex);
    assert.ok(
      r >= AA_TEXT,
      `--color-muted даёт ${r.toFixed(2)}:1 на поверхности «${name}» — нужно ${AA_TEXT}:1`,
    );
  }
});

/**
 * Граница поля ввода.
 *
 * WCAG 1.4.11 требует 3:1 для границ элементов формы. Волосяная линия
 * --color-line на бумаге даёт 1.2:1 и годится только для разделителей,
 * поэтому у формы отдельный токен. Объединив их в один, мы сделали бы поля
 * ввода практически невидимыми.
 */
test('граница поля ввода проходит 3:1', () => {
  for (const [name, hex] of [
    ['карточка', cssVar('surface')],
    ['страница', cssVar('bg')],
  ] as const) {
    const r = contrast(cssVar('line-strong'), hex);
    assert.ok(
      r >= 3,
      `--color-line-strong даёт ${r.toFixed(2)}:1 на «${name}» — нужно 3:1 (WCAG 1.4.11)`,
    );
  }
});

/**
 * Кнопки выбора периода: текст на подложке своего тона.
 *
 * Кнопки 14px, поэтому им нужен полный порог 4.5:1, а не 3:1 для крупного
 * текста. Подложка образуется НЕ токеном, а наложением полупрозрачного слоя
 * на поверхность, поэтому её считают отдельно: расчёт по токену фона давал
 * бы 4.98:1, и мы решили бы, что всё в порядке, хотя подложка светлее.
 *
 * Значения выведены из темы, а не зашиты: на тёмной теме здесь стояли
 * #1e1e25 и #1d1d37, на бумаге они другие.
 */
test('текст на полупрозрачных подложках кабинета проходит AA', () => {
  const surface = cssVar('surface');
  const checks: [string, string, string][] = [
    ['невыбранный период', cssVar('muted'), blend('#ffffff', surface, 0.05)],
    ['выбранный период', cssVar('accent-2'), blend(cssVar('accent'), surface, 0.15)],
  ];
  for (const [name, fg, bg] of checks) {
    const r = contrast(fg, bg);
    assert.ok(r >= AA_TEXT, `${name}: ${fg} на ${bg} даёт ${r.toFixed(2)}:1 — нужно ${AA_TEXT}:1`);
  }
});
