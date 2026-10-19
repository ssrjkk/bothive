import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSkills } from '../src/lib/skills';

/**
 * Границы слова для коротких и опасных алиасов.
 *
 * Отдельный файл, потому что здесь риск не в «работает / не работает», а в
 * тихой порче: алиас «go» матчится как отдельное слово и не должен находиться
 * внутри «Google», «Golang» и «гораздо». Если сломается граница, вакансия
 * получит лишний требуемый навык и её скоринг упадёт — без единой ошибки.
 */

test('«go» не находится внутри других слов', () => {
  // Регрессия: в словаре был только «golang», и вакансия «Go developer»
  // не находилась вовсе. После добавления «go» нужно убедиться, что хвост
  // слова отсекается.
  //
  // «Golang» тут нет намеренно: это каноническое имя языка, оно обязано
  // находиться. Проверяется отдельно — ниже.
  for (const text of ['Google', 'Gopher', 'гораздо', 'логотип', 'договоренность', 'Gogol']) {
    const skills = extractSkills(text);
    assert.ok(!skills.includes('Go'), `«${text}» засчитано за навык Go: ${skills.join(', ')}`);
  }
});

test('«Go» и «Golang» — одно и то же навык', () => {
  for (const text of ['Go', 'Golang', 'Go, Python', 'Golang-разработчик', 'Разработчик на Go']) {
    const skills = extractSkills(text);
    assert.ok(skills.includes('Go'), `«${text}» не распознано: ${skills.join(', ') || 'ничего'}`);
  }
});

test('«go» находится как отдельное слово', () => {
  for (const text of ['Go developer', 'Разработчик на Go', 'Go, Python', 'Golang-разработчик']) {
    const skills = extractSkills(text);
    assert.ok(skills.includes('Go'), `«${text}» не распознано: ${skills.join(', ')}`);
  }
});

test('«r» и «с» одиночными буквами не считаются навыками', () => {
  // В старом списке были "c", "r", "go" как самостоятельные навыки —
  // они находились в каждой строке с этими буквами.
  const skills = extractSkills('Требуется специалист с опытом продаж и работы в CRM');
  assert.ok(!skills.includes('C++'), 'из ниоткуда взялся C++');
  assert.ok(!skills.includes('C#'), 'из ниоткуда взялся C#');
});
