import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Иерархия заголовков.
 *
 * Моноширинная прописная метка — это не заголовок. На бумажной теме ею
 * оформлены Eyebrow и подписи колонок, то есть служебные метки; крупные
 * заголовки набраны антиквой.
 *
 * Ошибка проходила незаметно: два заголовка («Читайте также» в статье и
 * «Ключевые слова» в образце резюме) оказались набраны моноширинной
 * прописной строкой — визуально они выглядели как подписи к блокам, и в
 * оглавлении страницы выглядели как подписи тоже.
 *
 * Проверка по исходнику, а не по DOM: в DOM эти стили считались бы
 * одинаковыми, различие только в теге.
 */
/**
 * Все исходники, а не только отслеживаемые git.
 *
 * Раньше список брался из `git ls-files src`, и тест молча проверял ноль новых
 * файлов: всё, что ещё не закоммичено, из выдачи исчезало. Так в код попал
 * заголовок без антиквы — нарушение было видно только после `git add`.
 *
 * Обход каталога вместо выдачи git: проверка правила темы не должна зависеть
 * от того, закоммичен файл или нет. Недостаток — файлы в .gitignore тоже
 * попадут в обход, но для правила оформления это скорее правильно, чем нет.
 */
function sourceFiles(): string[] {
  const root = process.cwd();
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.'))
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(tsx|ts)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(join(root, 'src'));
  return out.sort();
}

test('служебная метка не надета на заголовок', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles()) {
    const content = readFileSync(file, 'utf8');

    for (const m of content.matchAll(/<(h[1-6])\b[^>]*className="([^"]*)"[^>]*>/g)) {
      const [, tag, cls] = m;
      // Метка: моноширинный + прописные + трекинг.
      const looksLikeLabel =
        /\bfont-mono\b/.test(cls!) && /\buppercase\b/.test(cls!) && /tracking-/.test(cls!);
      if (looksLikeLabel) {
        const line = content.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}  <${tag}> «${cls!.slice(0, 60)}»`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `метка набрана как заголовок — в структуре документа она станет пунктом оглавления:\n${offenders.join('\n')}`,
  );
});

test('заголовки разделов набраны антиквой, а не гротеском', () => {
  /*
   * Гротеск (шрифт по умолчанию в старой теме) на заголовке — это тот
   * самый вид «приложения из 2021 года». Проверяем по исходнику: все
   * уровни h1–h4 должны содержать font-serif либо display-утилиту.
   *
   * Исключений нет: там, где нужен интерфейсный гротеск, стоит не
   * заголовок. Если обоснованное исключение появится, пусть оно будет
   * явным списком здесь, а не молчаливым промахом.
   */
  const offenders: string[] = [];

  for (const file of sourceFiles()) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/<(h[1-4])\b[^>]*className="([^"]*)"[^>]*>/g)) {
      const cls = m[2]!;
      if (!/\bfont-serif\b/.test(cls) && !/\bdisplay\b/.test(cls)) {
        const line = content.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}  <${m[1]}> «${cls.slice(0, 70)}»`);
      }
    }
  }

  assert.deepEqual(offenders, [], `заголовок без антиквы:\n${offenders.join('\n')}`);
});
