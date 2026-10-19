import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSkills, parseKeywords, allSkillLabels } from '../src/lib/skills';

/**
 * Извлечение навыков.
 *
 * Подстрочный поиск, который стоял раньше, давал предсказуемую муру,
 * и обе её стороны шли в скоринг — то есть в решение «откликаться или нет»:
 *
 *   "JavaScript developer" -> ложное "java"     (java внутри javascript)
 *   любая строка с "c"    -> ложное "c"
 *   "Менеджер по продажам" -> ноль совпадений   (в списке был только sales)
 *
 * Проверяется не «вообще работает», а конкретно эти случаи: ложные
 * срабатывания и пропуски.
 */

test('java не находится внутри javascript', () => {
  const skills = extractSkills('JavaScript developer, React и TypeScript');

  assert.ok(skills.includes('JavaScript'), 'JavaScript не найден');
  assert.ok(!skills.includes('Java'), `в «JavaScript» найдено лишнее «Java»: ${skills.join(', ')}`);
});

test('буквы в середине слова не дают навык', () => {
  // «c» был в старом списке как самостоятельный навык и находился в каждой
  // строке, где есть латинская «c».
  const skills = extractSkills('Разработчик в области высоких нагрузок');
  assert.ok(!skills.includes('C++'), 'из ниоткуда взялся C++');
  assert.ok(!skills.includes('C#'), 'из ниоткуда взялся C#');
});

test('реактивность не даёт React', () => {
  const skills = extractSkills('Опыт разработки реактивных интерфейсов');
  assert.ok(!skills.includes('React'), `«реактивность» посчитана за React: ${skills.join(', ')}`);
});

test('русские названия находят английские навыки и наоборот', () => {
  const skills = extractSkills('Менеджер по продажам, опыт работы с CRM и холодными звонками');

  assert.ok(skills.includes('Продажи'), `«продажи» не распознаны: ${skills.join(', ')}`);
  assert.ok(skills.includes('CRM'), `CRM не распознан: ${skills.join(', ')}`);
});

/**
 * Русская морфология: нормативная и родительная формы.
 *
 * «Менеджер по продажам» — предложный падеж, «Продажи» — именительный. Это
 * разные словоформы, и простой подстровый поиск по «продаж» находит первую,
 * а не вторую. Именно этим объяснялось, почему русскоязычные вакансии не
 * находились ни по одному навыку: в старом словаре были только английские
 * формы.
 */
test('падежные формы находятся одинаково', () => {
  const forms = [
    ['Продажи', ['Продажи', 'продаж', 'Продажам', 'продажами', 'продажах']],
    ['Финансы', ['Финансы', 'финансы', 'Финансов', 'финансовый']],
    ['Логистика', ['Логистика', 'логистик', 'Логистике']],
    ['Таргетинг', ['Таргетинг', 'таргет', 'таргетированной']],
  ] as const;

  for (const [label, variants] of forms) {
    for (const variant of variants) {
      const skills = extractSkills(`Опыт: ${variant}`);
      assert.ok(
        skills.includes(label),
        `«${variant}» не распознано как «${label}»: ${skills.join(', ') || 'ничего'}`,
      );
    }
  }
});

test('Skill без русского синонима не выдумывается', () => {
  // Kubernetes — слово уникальное, подстрока «k8s» в кириллице не прячется.
  const skills = extractSkills('Инженер по инфраструктуре Kubernetes и Docker');
  assert.ok(skills.includes('Kubernetes'), 'Kubernetes не найден');
  assert.ok(skills.includes('Docker'), 'Docker не найден');
});

test('технические имена с точкой и слешем матчатся целиком', () => {
  const skills = extractSkills('Опыт: Node.js, Next.js, CI/CD, k8s');

  assert.ok(skills.includes('Node.js'), `Node.js не найден: ${skills.join(', ')}`);
  assert.ok(skills.includes('Next.js'), `Next.js не найден: ${skills.join(', ')}`);
  assert.ok(skills.includes('CI/CD'), `CI/CD не найден: ${skills.join(', ')}`);
  assert.ok(skills.includes('Kubernetes'), `k8s не распознан как Kubernetes: ${skills.join(', ')}`);
});

test('пустой текст не выдумывает навыков', () => {
  assert.deepEqual(extractSkills(''), []);
  assert.deepEqual(extractSkills('   '), []);
});

test('результат детерминирован', () => {
  const text = 'Python, Django, PostgreSQL, Redis, Docker';
  const a = extractSkills(text);
  const b = extractSkills(text);
  assert.deepEqual(a, b, 'порядок зависит от прогона');
});

test('словарь не содержит битых символов', () => {
  // Регрессия записи файла: в алиасе Elasticsearch был повреждённый символ.
  const probe = extractSkills('эластиксерч elasticsearch');
  assert.ok(
    probe.includes('Elasticsearch'),
    `русский алиас Elasticsearch не работает: ${probe.join(', ')}`,
  );
});

/**
 * Каноническое имя должно находиться в собственном резюме.
 *
 * Не «по любому алиасу»: словарь хранит нормативную форму («Менеджер по
 * продажам» находит «Продажи» по алиасу «продажи»), но само имя навыка
 * обязано срабатывать — иначе пользователь, назвавший навык в резюме
 * канонически, получит «вам не хватает навыка, которого у вас нет».
 */
test('каждый навык находится по собственному имени', () => {
  const unreachable = allSkillLabels().filter((label) => {
    // Проверяем имя как есть, в нижнем регистре, как придёт в тексте.
    return !extractSkills(label).includes(label);
  });
  assert.deepEqual(
    unreachable,
    [],
    `навыки не находятся по своему имени — резюме с ними будет считаться пустым:\n${unreachable.join('\n')}`,
  );
});

test('ключевые слова разбираются на навыки и обычные слова', () => {
  const parsed = parseKeywords('React, TypeScript, Москва, удалённо');

  assert.ok(parsed.skills.includes('React'), 'React не распознан как навык');
  assert.ok(parsed.skills.includes('TypeScript'), 'TypeScript не распознан как навык');
  assert.ok(parsed.words.includes('Москва'), `«Москва» потеряна: ${parsed.words.join(', ')}`);
  assert.ok(parsed.words.includes('удалённо'), `«удалённо» потеряно: ${parsed.words.join(', ')}`);
});

test('ключевые слова без запятых тоже разбираются', () => {
  const parsed = parseKeywords('Python Django');

  assert.ok(parsed.skills.includes('Python'), 'Python не распознан');
  assert.ok(parsed.skills.includes('Django'), 'Django не распознан');
});

test('разбор ключевых слов устойчив к пустому вводу', () => {
  assert.deepEqual(parseKeywords(''), { skills: [], words: [] });
  assert.deepEqual(parseKeywords('   '), { skills: [], words: [] });
});
