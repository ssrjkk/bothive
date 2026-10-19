import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Все исходники на диске.
 *
 * Список из `git ls-files src` содержал удалённые файлы (индекс обновляется
 * только при явном `git rm`), и проверки падали с ENOENT на файле, которого
 * уже нет. Заодно новые файлы не проверялись вовсе.
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
 * Структурные стражи по кабинету.
 *
 * Здесь осталось только то, что тесты поведения НЕ покрывают: они рендерят
 * сам компонент, но ничего не знают о том, что его правильно используют
 * в менеджерах. Регулярки по поведению (есть ли в коде role="dialog",
 * совпадает ли текст ветки) вынесены в dialog-behavior.test.tsx и
 * status-message.test.tsx — там они настоящие.
 *
 * Прежняя версия файла проверяла регулярками сам dialog.tsx. Это была
 * иллюзия покрытия: перепиши функцию эквивалентно — тест сломается;
 * сломай поведение, оставив текст, — тест пройдёт.
 */

/**
 * Файлы кабинета.
 *
 * Обход каталога, а не выдача `git ls-files`: индекс хранит удалённые файлы
 * до явного `git rm`, и проверка падала с ENOENT на файле, которого на диске
 * уже нет. Новые файлы, наоборот, в индекс не попадали и не проверялись.
 */
function dashboardFiles(): string[] {
  return sourceFiles().filter((f) => f.replace(/\\/g, '/').includes('src/components/dashboard/'));
}

test('модальные окна не собираются вручную', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles().filter((f) => /\.tsx$/.test(f))) {
    const content = readFileSync(file, 'utf8');
    // Регулярки смотрим по коду без блочных комментариев: в шапке
    // dialog.tsx объясняется, какой класс подложки был раньше, и этот
    // текст срабатывал как нарушение собственного правила.
    const code = content.replace(/\/\*[\s\S]*?\*\//g, '');
    // Признак самодельного оверлея: fixed inset-0 + затемнение подложки.
    if (/fixed inset-0/.test(code) && /bg-black\/\d+/.test(code)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `ручная вёрстка модалки вместо @/components/dialog:\n${offenders.join('\n')}`,
  );
});

test('удаление в менеджерах идёт через подтверждение', () => {
  const managers = [
    'src/components/dashboard/resumes-manager.tsx',
    'src/components/dashboard/letters-manager.tsx',
    'src/components/dashboard/jobs-explorer.tsx',
  ];
  for (const file of managers) {
    const content = readFileSync(file, 'utf8');
    assert.match(content, /ConfirmDialog/, `${file}: удаление без подтверждения`);
    // Кнопка должна открывать окно, а не удалять сразу: вызов remove
    // прямо в обработчике — это удаление в один клик.
    assert.doesNotMatch(
      content,
      /onClick=\{\(\) => remove\(/,
      `${file}: удаление выполняется напрямую, без подтверждения`,
    );
  }
});

test('удаление защищено от повторного клика', () => {
  for (const file of [
    'src/components/dashboard/resumes-manager.tsx',
    'src/components/dashboard/letters-manager.tsx',
    'src/components/dashboard/jobs-explorer.tsx',
  ]) {
    const content = readFileSync(file, 'utf8');
    assert.match(
      content,
      /if \(removingId !== null\) return;/,
      `${file}: нет защиты от гонки при двойном клике`,
    );
  }
});

test('сообщения форм объявляются скринридеру', () => {
  // Проверяем все компоненты кашбинета, а не выборочный список: таких мест
  // было десять, и в каждом атрибут надо было не забыть.
  const offenders: string[] = [];

  for (const file of dashboardFiles()) {
    const content = readFileSync(file, 'utf8');
    // Компонент показывает пользователю ошибку или уведомление...
    if (!/\{error \?|\{notice \?/.test(content)) continue;
    // ...и при этом не отдаёт её в живую область.
    const announces =
      /StatusMessage/.test(content) ||
      /aria-live=/.test(content) ||
      /role="status"|role="alert"/.test(content) ||
      /"status"\s*:\s*"alert"/.test(content);
    if (!announces) offenders.push(file);
  }

  assert.deepEqual(
    offenders,
    [],
    `сообщение выводится, но не озвучивается:\n${offenders.join('\n')}`,
  );
});

test('живая область не смонтирована условно', () => {
  // {error ? <StatusMessage>{error}</StatusMessage> : null} означает, что
  // область и текст появляются одним рендером, и часть скринридеров
  // такую вставку не объявляет.
  const offenders: string[] = [];
  for (const file of dashboardFiles()) {
    const content = readFileSync(file, 'utf8');
    if (/\{(error|notice)[^}]*\?\s*<StatusMessage/.test(content)) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `живая область смонтирована условно:\n${offenders.join('\n')}`);
});
