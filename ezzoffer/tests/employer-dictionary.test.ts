import test, { before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Словарь требований из вакансии (легальная половина совета «соберите словарь
 * работодателя»).
 *
 * Смысл: ATS и рекрутер смотрят, совпадают ли формулировки резюме с текстом
 * вакансии. Но сравнивать надо не со всем подряд, а с тем, что работодатель
 * повторил: одно требование, случайно мелькнувшее в описании, и повторённое
 * трижды — это разный вес. Раньше `detectKeywords` смотрел на само резюме,
 * то есть сравнивало резюме с самим собой и говорило «всё хорошо».
 *
 * Важнее другое: результат — это список ТРЕБОВАНИЙ, а не совет вставить их в
 * резюме. Формулировка из раздела «Проверка утверждений» карты: модель не
 * придумывает навык, которого у человека нет. Отсюда и разделение совпавшего
 * и недостающего.
 */

let employerDictionary: typeof import('../src/lib/employer-dictionary').employerDictionary;
let resumeMatch: typeof import('../src/lib/employer-dictionary').resumeMatch;

before(async () => {
  ({ employerDictionary, resumeMatch } = await import('../src/lib/employer-dictionary'));
});

const VACANCY = `
Требуется Frontend-разработчик в команду платформы.
Обязанности:
- Разработка интерфейсов на React и TypeScript;
- Интеграция с API, интеграция сторонних сервисов;
- Сборка и деплой через Docker, настройка CI/CD;
- Обязательно: TypeScript. React обязателен. Docker обязателен.
Мы ценим опыт с Next.js и PostgreSQL.
Оплата откликов не требуется, пишите в Telegram.
`;

test('требования извлекаются из текста вакансии', () => {
  const dict = employerDictionary(VACANCY);
  const labels = dict.map((r) => r.label);

  for (const must of ['React', 'TypeScript', 'Docker']) {
    assert.ok(
      labels.includes(must),
      `не извлечено обязательное требование ${must}: ${labels.join(', ')}`,
    );
  }
  assert.ok(labels.includes('CI/CD'), `не извлечено CI/CD: ${labels.join(', ')}`);
});

test('повторённое требование весит больше единичного упоминания', () => {
  const dict = employerDictionary(VACANCY);
  const react = dict.find((r) => r.label === 'React');
  const postgres = dict.find((r) => r.label === 'PostgreSQL');

  assert.ok(react && postgres, 'требования не найдены');
  assert.ok(
    react!.mentions > postgres!.mentions,
    `повторённый React (${react!.mentions}) не вывесили над единичным PostgreSQL (${postgres!.mentions})`,
  );
  assert.ok(dict.indexOf(react!) < dict.indexOf(postgres!), 'порядок не отсортирован по весу');
});

/*
 * Регрессия: повторы через пробел считались как одно упоминание.
 *
 * Шаблон `(^|[^...])alias($|[^...])` включал границы в совпадение и съедал их:
 * в «React react» пробел уходил в первое совпадение, второму не хватало
 * ведущей границы. С запятыми ошибки не было, поэтому она жила долго: в
 * реальных текстах навыки чаще перечисляются через запятую.
 */
test('повторы через пробел считаются все, а не один (regression)', () => {
  const two = employerDictionary('Нужен React react разработчик');
  assert.equal(two.find((r) => r.label === 'React')?.mentions, 2);

  const three = employerDictionary('Django django, django!');
  assert.equal(three.find((r) => r.label === 'Django')?.mentions, 3);
});

test('подстрока по-прежнему не считается вхождением', () => {
  assert.deepEqual(employerDictionary('TypeScriptTypeScript'), []);
});

test('словарь не выдумывает требования, которых в вакансии нет', () => {
  const dict = employerDictionary('Вакансия: менеджер по продажам, общение с клиентами.');
  const labels = dict.map((r) => r.label);
  for (const fake of ['Kubernetes', 'Terraform', 'Figma']) {
    assert.ok(!labels.includes(fake), `в словарь попал ${fake}, которого в тексте нет`);
  }
});

test('совпадение показывает разрыв, а не хвалит само себя', () => {
  const resume = 'Опыт 5 лет. React, TypeScript, JavaScript. Немного Docker в пет-проектах.';
  const match = resumeMatch(resume, VACANCY);

  const matched = match.matched.map((m) => m.label);
  assert.ok(matched.includes('React'), `React должен совпасть: ${matched.join(', ')}`);
  assert.ok(matched.includes('TypeScript'), `TypeScript должен совпасть: ${matched.join(', ')}`);

  const missing = match.missing.map((m) => m.label);
  assert.ok(missing.includes('CI/CD'), `CI/CD должен быть в пробеле: ${missing.join(', ')}`);

  assert.ok(match.coverage > 0 && match.coverage < 1, `покрытие ${match.coverage} не содержит дыр`);
  assert.ok(
    match.notice.includes('не') || match.notice.includes('пробел'),
    `не сказано прямо, что есть пробелы: «${match.notice}»`,
  );
});

test('пробел — это требование работодателя, а не приговор резюме', () => {
  const resume = 'Опыт 3 года. React, JavaScript.';
  const match = resumeMatch(resume, VACANCY);

  assert.ok(match.missing.length > 0, 'пробелов нет — а вакансия требует кучу всего');
  for (const m of match.missing) {
    assert.ok(
      /резюме|ваканси|работодател/i.test(m.hint),
      `по пробелу не сказано, что это ожидание работодателя: ${JSON.stringify(m)}`,
    );
  }
});

test('пустая вакансия не вызывает выводов', () => {
  const dict = employerDictionary('');
  assert.equal(dict.length, 0);

  const match = resumeMatch('React, Docker', '');
  assert.equal(match.matched.length, 0);
  assert.equal(match.coverage, 0, 'по пустой вакансии объявлено покрытие');
  assert.ok(match.notice.length > 0, 'пустая вакансия прошла без предупреждения');
});
