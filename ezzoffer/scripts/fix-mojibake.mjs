/**
 * Поиск и починка «испорченного UTF-8» (mojibake).
 *
 * Симптом: русский текст, прочитанный как CP1251 и записанный обратно в UTF-8.
 * Видно как «РµРѕС‚Р°», «РёР·РЅР°С‡Р°Р» — плотные «Р» и «Рѕ».
 *
 * ## Почему скрипт не портит нормальный текст
 *
 * Обратное преобразование однозначно: символы обратно кладутся в байты CP1251
 * (так их видел сломанный терминал), и эти байты читаются как UTF-8.
 *
 * Кажется, что такой разбор может «случайно» сработать на правильном тексте и
 * испортить его. Для БУКВ это исключено: кириллица CP1251 лежит в 0xC0–0xFF, а
 * байт продолжения UTF-8 — 0x80–0xBF, и пересечения нет. Но для знаков
 * препинания утверждение неверно: «Е» — это 0xC5, «» — 0xBB, а вместе D5 BB —
 * корректный UTF-8 («Ц»). Версия скрипта без проверки «чинила» строку
 * `«Водитель категории Е».` в `«Водитель категории Ц.` и портила три файла.
 *
 * Поэтому разбор разрешён только строкам, где есть символ, невозможный в
 * нормальном русском тексте (см. IMPOSSIBLE). Ложных срабатываний нет по
 * построению, а не по подбору порога. Плата — пропуски: испорченный текст без
 * таких символов (например `РЅРµ` от «не») починен не будет. Это осознанный
 * размен: лучше не тронуть строку, чем съесть кавычку.
 *
 * ## Запуск
 *
 *   node scripts/fix-mojibake.mjs             — только отчёт
 *   node scripts/fix-mojibake.mjs --preview   — показать «до/после»
 *   node scripts/fix-mojibake.mjs --write     — починить
 */
import { readFileSync, writeFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

const WRITE = process.argv.includes('--write');
const PREVIEW = process.argv.includes('--preview');
const ROOTS = ['src', 'tests', 'scripts'];

/**
 * Обратная таблица CP1251: символ → байт.
 *
 * Собирается перебором всех 256 байтов через TextDecoder, потому что Node
 * умеет ДЕКОДИРОВАТЬ windows-1251 (при полном ICU), но не кодировать в неё.
 *
 * Это не косметика: символы вида `Рѕ` лежат в U+0420–U+04FF, а `latin1` —
 * единственная однобайтовая кодировка в Node — их просто обрезает по младшему
 * байту, и вместо починки получается новый мусор.
 */
const CP1251 = (() => {
  const dec = new TextDecoder('windows-1251');
  const map = new Map();
  for (let b = 0; b < 256; b++) map.set(dec.decode(Uint8Array.of(b)), b);
  return map;
})();

/**
 * Символы, которых в нормальном русском тексте не бывает.
 *
 * Именно они и служат признаком: строка разбирается на части ТОЛЬКО если
 * содержит хотя бы один такой символ.
 *
 * Почему нельзя проверять все подряд. Кажется, что разбор всегда однозначен и
 * ложных срабатываний не будет: кириллица CP1251 лежит в 0xC0–0xFF, а
 * продолжение UTF-8 — 0x80–0xBF, пересечения нет. Это верно для БУКВ, но не
 * для знаков препинания. «Е» — это 0xC5, «» — 0xBB, а вместе D5 BB — это
 * корректный UTF-8 («Ц»). Наивный скрипт «чинил» строку
 * `«Водитель категории Е».` в `«Водитель категории Ц.` и портил три файла.
 *
 * Перечисленные символы — это остатки байтов 0x80–0xBF в CP1251: дубль-кавычки
 * низшей линии, «крестики», «параграф», знак авторских прав, микро, градус. В
 * русском тексте их не бывает, а в испорченном — бывают всегда, потому что
 * каждая буква UTF-8 состоит из двух байт, и второй почти всегда попадает
 * именно сюда.
 *
 * Цена решения — пропуски: испорченный текст без таких символов (например
 * `РЅРµ` от «не») починен не будет. Это осознанный размен: скрипт предпочитает
 * не тронуть строку, чем съесть кавычку в нормальном тексте.
 */
const IMPOSSIBLE = new Set([
  'Ђ',
  'Ѓ',
  'Є',
  'Ѕ',
  'І',
  'Ї',
  'Ј',
  'Љ',
  'Њ',
  'Ћ',
  'Ќ',
  'Ѝ',
  'Ў',
  'Џ',
  'ў',
  'ѐ',
  'ѓ',
  'ї',
  'ѕ',
  'ъ',
  'і',
  '‚',
  '„',
  '‟',
  '†',
  '‡',
  '‰',
  '±',
  '²',
  '³',
  '¢',
  '¦',
  '§',
  '©',
  'ª',
  '¶',
  'µ',
  '°',
  '•',
  '“',
  '‘',
  '‚',
  '„',
  '…',
]);

function isMojibake(line) {
  for (const ch of line) if (IMPOSSIBLE.has(ch)) return true;
  return false;
}

/**
 * Множество символов, которыми мог испорчиться русский текст.
 *
 * Это ровно те не-ASCII символы, которые даёт разбор UTF-8 как CP1251:
 * кириллица (U+0400–U+04FF), латиница-1 (µ, °, ё) и типографская пунктуация
 * CP1251 («‘», ’, « », …). Ограничить множество блоком U+0400 было ошибкой:
 * `Рѕ` — это `Р` (U+0420) и `ѕ` (U+0455), но `µ` в других словах — уже
 * U+00B5, а закрывающая кавычка в «проверь» — U+2018. Диапазон рвал
 * испорченное слово на куски, и половина оставалась битой.
 *
 * Множество строится из самой обратной таблицы, а не выписывается руками: так
 * оно по определению совпадает с тем, что умеет восстановить починка.
 */
const DIRTY = new Set(
  [...CP1251.entries()].filter(([ch]) => ch.codePointAt(0) > 0x7f).map(([ch]) => ch),
);

/**
 * Разбивает строку на участки «испорченное» и «нормальное».
 *
 * Пробел, скобка и прочая ASCII-пунктуация в множество не входят, поэтому
 * обычный русский текст разбивается максимально мелко и чистится сам собой.
 */
function segments(line) {
  const out = [];
  let cur = '';
  let curDirty = false;
  for (const ch of line) {
    const dirty = DIRTY.has(ch);
    if (cur && dirty !== curDirty) {
      out.push([cur, curDirty]);
      cur = '';
    }
    cur += ch;
    curDirty = dirty;
  }
  if (cur) out.push([cur, curDirty]);
  return out;
}

/** Обратный разбор одного участка; null, если разобрать нельзя. */
function unMojibake(text) {
  const bytes = [];
  for (const ch of text) {
    const b = CP1251.get(ch);
    if (b === undefined) return null;
    bytes.push(b);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

/**
 * Починка строки.
 *
 * Участки, а не вся строка: символы вроде `<` и `"` в CP1251 отсутствуют, и при
 * «всё или ничего» одна лишняя кавычка отменяла бы починку всей строки —
 * `assert.equal(..., "state РЅРµ РїСЂРѕС€С‘Р»")` оставалась битой из-за `‘`.
 */
function repairLine(line) {
  if (!isMojibake(line)) return line;
  return segments(line)
    .map(([text, dirty]) => (dirty ? (unMojibake(text) ?? text) : text))
    .join('');
}

function repair(text) {
  let changed = 0;
  const out = text.split(/(?<=\n)/).map((line) => {
    const fixed = repairLine(line);
    if (fixed !== line) changed++;
    return fixed;
  });
  return changed ? out.join('') : null;
}

let totalLines = 0;
const touched = [];

for (const root of ROOTS) {
  for (const file of globSync(join(root, '**', '*.{ts,tsx,mjs,js,md,css}'), { posix: true })) {
    // Сам скрипт содержит битые примеры в комментариях и починил бы сам себя.
    if (file.replace(/\\/g, '/').endsWith('fix-mojibake.mjs')) continue;
    const src = readFileSync(file, 'utf8');
    const fixed = repair(src);
    if (!fixed) continue;
    const before = src.split('\n');
    const after = fixed.split('\n');
    const changedLines = before.filter((l, i) => l !== after[i]).length;
    totalLines += changedLines;
    touched.push({ file, changedLines, before, after });
    if (PREVIEW) {
      before.forEach((l, i) => {
        if (l !== after[i]) {
          console.log(
            `${file}:${i + 1}\n  - ${l.trim().slice(0, 120)}\n  + ${after[i].trim().slice(0, 120)}`,
          );
        }
      });
    }
    if (WRITE) writeFileSync(file, fixed, 'utf8');
  }
}

if (!PREVIEW) {
  for (const t of touched.sort((a, b) => b.changedLines - a.changedLines)) {
    console.log(`${t.file}: ${t.changedLines} строк`);
  }
}
console.log(
  `\nфайлов с испорченным UTF-8: ${touched.length}, строк: ${totalLines}` +
    (WRITE
      ? ' — починено'
      : PREVIEW
        ? ' — предпросмотр, ничего не записано'
        : ' (запустите с --preview)'),
);
