import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceResume, scoreResume, detectKeywords } from '../src/lib/resume-enhance';

/**
 * ATS-скоринг.
 *
 * Регрессия 1: «после» вычислялось как `beforeScore + 42 + keywords*2` с потолком
 * 98 — то есть всегда выше исходного и не зависело от реального текста.
 * Пользователь видел «34 → 92» независимо от того, что изменилось.
 *
 * Регрессия 2: detectKeywords искал алиас как префикс (`includes(` ${a}`)`),
 * поэтому «Работа с JavaScriptCore» давал навык «JavaScript», а «реактивность» —
 * «React». В резюме попадали навыки, которых у кандидата нет.
 */

const PLAIN = 'Опыт работы\n- Разработка сайтов';

/*
 * Регрессия 3: пересекающиеся алиасы давали дубль.
 *
 * «postgresql» и «postgres» входят в наборы сразу двух навыков — SQL и
 * PostgreSQL. Текст «Опыт: PostgreSQL» давал оба, и список ключевых слов
 * (всего 9 слотов) забивался дублями. Спорный алиас уходит самому
 * специфичному владельцу — самому длинному label.
 */
test('пересекающиеся алиасы не плодят дубли (regression)', () => {
  assert.deepEqual(detectKeywords('Опыт: PostgreSQL, оптимизация запросов'), ['PostgreSQL']);
  assert.deepEqual(detectKeywords('Опыт: Postgres, индексы'), ['PostgreSQL']);
  assert.deepEqual(detectKeywords('Опыт: MySQL, репликация'), ['SQL']);
  assert.deepEqual(detectKeywords('Опыт: SQL, join-ы'), ['SQL']);
  assert.deepEqual(detectKeywords('Опыт: PostgreSQL и MySQL'), ['PostgreSQL', 'SQL']);
});

test('«после» — реальный пересчёт, а не прибавка', () => {
  const result = enhanceResume(PLAIN);
  assert.ok(result.after <= 100 && result.after >= 0, `балл вне диапазона: ${result.after}`);
  // «После» обязано быть оценкой ИТОГОВОГО текста, а не исходного плюс константа.
  assert.equal(result.after, scoreResume(result.content, detectKeywords(result.content)));
});

test('балл не растёт искусственно на пустом улучшении', () => {
  // Резюме уже содержит все разделы, буллеты и цифры — улучшать нечего,
  // и «после» не должно упереться в потолок 98.
  const perfect = [
    'Опыт работы',
    '- Ускорил релиз на 30%, сократил баги на 25%',
    'Образование',
    '- МГТУ, 2020',
    'Ключевые навыки',
    '- React, TypeScript, Node.js, PostgreSQL, Docker, Git',
  ].join('\n');
  const result = enhanceResume(perfect);
  assert.ok(
    result.after < 98,
    `подозрительно высокий балл без реальных изменений: ${result.after}`,
  );
});

test('реальное улучшение поднимает балл', () => {
  const weak = 'Опыт работы\n- Делал разное';
  const result = enhanceResume(weak);
  assert.ok(
    result.after >= result.before,
    `улучшение не должно понижать балл: было ${result.before}, стало ${result.after}`,
  );
});

test('detectKeywords не срабатывает на префикс слова', () => {
  const kws = detectKeywords('Опыт работы с JavaScriptCore и реактивным подходом');
  assert.ok(!kws.includes('JavaScript'), `JavaScript не должен матчиться в JavaScriptCore: ${kws}`);
  assert.ok(!kws.includes('React'), `React не должен матчиться в «реактивным»: ${kws}`);
});

test('detectKeywords находит настоящие навыки', () => {
  const kws = detectKeywords('Опыт: React, TypeScript, PostgreSQL, Docker. Умею git и bash.');
  assert.ok(kws.includes('React'), `ожидался React, получено ${kws}`);
  assert.ok(kws.includes('TypeScript'), `ожидался TypeScript, получено ${kws}`);
  assert.ok(kws.includes('PostgreSQL'), `ожидался PostgreSQL, получено ${kws}`);
  assert.ok(kws.includes('Docker'), `ожидался Docker, получено ${kws}`);
});

test('навык в склонении/другом регистре распознаётся', () => {
  const kws = detectKeywords('Пишу на typescript и react, деплою через docker');
  assert.ok(kws.includes('TypeScript'), `ожидался TypeScript, получено ${kws}`);
  assert.ok(kws.includes('React'), `ожидался React, получено ${kws}`);
});

test('scoreResume детерминирован и в диапазоне 0..100', () => {
  const s1 = scoreResume(PLAIN);
  const s2 = scoreResume(PLAIN);
  assert.equal(s1, s2);
  assert.ok(s1 >= 0 && s1 <= 100);
});

test('пустой текст не падает', () => {
  assert.ok(scoreResume('') >= 0);
  assert.deepEqual(detectKeywords(''), []);
  assert.doesNotThrow(() => enhanceResume(''));
});
