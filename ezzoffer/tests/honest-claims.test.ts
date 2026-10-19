import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Обещания о безопасности должны соответствовать коду.
 *
 * На лендинге и в разделе «О компании» стояли утверждения, которые
 * продукт не выполняет:
 *
 *  - «Мы не храним доступы к твоему аккаунту» — при этом hh-oauth.ts
 *    пишет access и refresh-токены в users.hh_token и
 *    users.hh_refresh_token, иначе не работала бы синхронизация;
 *  - «Работаем только через официальные механизмы, без серых схем» —
 *    при этом anti-ban.ts реализует джиттер 45–180 секунд, рабочие часы
 *    и суточный лимит именно для того, чтобы отклики выглядели ручными;
 *  - «Отклики неотличимы от ручных» — то же самое, но прямым текстом;
 *  - «Никаких серых схем, рисков и блокировок» — блокировка прямо
 *    упоминается как возможная на /platform-rules.
 *
 * Такое расхождение опасно не эстетически: человек читает «безопасно»,
 * подключает аккаунт, получает блокировку за то, о чём его не
 * предупредили.
 *
 * Тест ловит именно возврат этих формулировок. Он НЕ проверяет, что
 * продукт устроен правильно, — это уже работа тестов anti-ban и
 * hh-oauth. Здесь проверяется одно: текст не обещает того, чего нет.
 */

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

/** Возвращает текст, попадающий пользователю: убираем комментарии и код. */
function userFacingText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
}

test('текст не обещает отсутствие блокировки', () => {
  // Проверяется наличие ТОЧНЫХ оборотов. Общее «безопасно» пропускаем:
  // оно может относиться к шифрованию или к хранению паролей.
  const FORBIDDEN = [
    'никаких серых схем, рисков и блокировок',
    'без рисков и блокировок',
    'исключает блокировку',
    'гарантирует отсутствие блокировки',
  ];

  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const text = userFacingText(readFileSync(file, 'utf8')).toLowerCase();
    for (const phrase of FORBIDDEN) {
      if (text.includes(phrase)) {
        const line = readFileSync(file, 'utf8').slice(0, text.indexOf(phrase)).split('\n').length;
        offenders.push(`${file}:~${line}  «${phrase}»`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `текст обещает то, чего сервис не гарантирует:\n${offenders.join('\n')}`,
  );
});

test('текст не отрицает хранение токена доступа', () => {
  /*
   * Единственное место, где сервис прямо говорит, что не хранит токен, —
   * /platform-rules: там сказано, что при отзыве доступа отклики
   * перестанут работать. В остальных текстах утверждать обратное нельзя:
   * hh-oauth.ts пишет токены в базу, и это необходимо для работы.
   */
  const FORBIDDEN = [
    'не храним доступы',
    'не храним токен',
    'не храним пароль',
    'не управляем вашим профилем и не храним',
  ];

  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const raw = readFileSync(file, 'utf8');
    const text = userFacingText(raw).toLowerCase();
    for (const phrase of FORBIDDEN) {
      if (text.includes(phrase)) {
        const line = raw.slice(0, raw.toLowerCase().indexOf(phrase)).split('\n').length;
        offenders.push(`${file}:~${line}  «${phrase}»`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `сервис хранит токен (users.hh_token) — отрицать это в тексте нельзя:\n${offenders.join('\n')}`,
  );
});

test('текст не отрицает маскировку под человека', () => {
  // anti-ban.ts реализует обходное поведение, поэтому фразы
  // «не обходим защиту платформ» и «неотличимы от ручных» ложны:
  // первое — про то, чего код не делает; второе — про то, что он
  // делает как раз.
  const FORBIDDEN = [
    'не обходим защиту платформ',
    'не имитируем поддельные действия',
    'неотличимы от ручных',
    'отклики неотличимы',
  ];

  const offenders: string[] = [];
  for (const file of sourceFiles()) {
    const raw = readFileSync(file, 'utf8');
    const text = userFacingText(raw).toLowerCase();
    for (const phrase of FORBIDDEN) {
      if (text.includes(phrase)) {
        const line = raw.slice(0, raw.toLowerCase().indexOf(phrase)).split('\n').length;
        offenders.push(`${file}:~${line}  «${phrase}»`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `anti-ban.ts добавляет паузы, чтобы не выглядеть ботом — отрицать это нельзя:\n${offenders.join('\n')}`,
  );
});

/**
 * Страница правил обязана говорить про риск прямо.
 *
 * Если когда-нибудь тексты снова станут оптимистичнее кода, страница
 * /platform-rules обязана это компенсировать. Проверяем, что на ней
 * остались все три оговорки: про токен, про блокировку и про то, что
 * сервис управляет откликами от вашего имени.
 */
test('страница правил сохраняет оговорки о рисках', () => {
  const rules = userFacingText(
    readFileSync('src/app/platform-rules/page.tsx', 'utf8'),
  ).toLowerCase();

  const REQUIRED = [
    ['токен хранится', 'храним токен'],
    ['возможна блокировка', 'блокировк'],
    ['паузы и лимиты', 'пауз'],
    ['официальный api', 'api'],
  ];

  const missing = REQUIRED.filter(([, needle]) => !rules.includes(needle)).map(([label]) => label);
  assert.deepEqual(missing, [], `на /platform-rules пропали оговорки: ${missing.join(', ')}`);
});
