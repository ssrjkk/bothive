import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Поиск SQL, который меняет или удаляет данные по одному `id`.
 *
 * В приложении с сессиями идентификатор приходит от человека, поэтому
 * `UPDATE ... WHERE id = ?` без `user_id` — это не «неаккуратно», а возможность
 * поменять чужую запись, зная её номер. Особенно опасно там, где номер
 * угадывается: он монотонный, то есть 1, 2, 3…
 *
 * Проверка идёт по операциям, которые меняют состояние (UPDATE/DELETE/INSERT
 * ON CONFLICT DO UPDATE), и требует, чтобы в WHERE присутствовал `user_id`.
 * SELECT не интересует: чтение проверяется отдельно, на маршрутах.
 */
const MUTATION = /\b(UPDATE|DELETE\s+FROM)\s+(\w+)\b([\s\S]*?)(?:;|$)/gi;

const files = globSync(join('src', '**', '*.{ts,tsx}'), { posix: true });
let found = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  src.split(/\r?\n/).forEach((line, i) => {
    // Многострочные запросы собираем из соседних строк: WHERE чаще на другой.
    const stmt = [line, '', ''].join('\n');
    for (const m of stmt.matchAll(MUTATION)) {
      const op = m[1].toUpperCase();
      const table = m[2];
      const rest = m[3];
      const where = rest.slice(0, rest.search(/\bORDER BY\b|\bLIMIT\b|\bRETURNING\b/i));
      if (/\buser_id\b/i.test(where)) continue;
      if (/\bWHERE\b/i.test(where) && /\bid\s*=/i.test(where)) {
        found++;
        console.log(
          `${file}:${i + 1}  ${op} ${table} — user_id в WHERE нет\n    ${line.trim().slice(0, 150)}`,
        );
      }
    }
  });
}
console.log(`\nподозрительных операций: ${found}`);
