import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Регрессия на запись связанных сущностей в applications.
 *
 * В POST /api/applications в БД писались `data.letterId` и `data.resumeId` —
 * то есть значения из тела запроса, которые при автоподборе равны null.
 * При этом реально использованные письмо и резюме вычислялись отдельно
 * (selectedLetterId и последнее обновлённое резюме) — и именно они уходили в hh.ru.
 *
 * Итог: в кабинете отклик отображался «без резюме и письма», хотя был реально
 * отправлен с ними, а история «каким письмом откликнулись» оставалась пустой.
 *
 * Полный вызов POST требует HTTP-контекста и сессии, поэтому проверяем исходник
 * роута. Регулярные выражения терпимы к переносам строк и отступам, чтобы
 * переформатирование файла не роняло тест по ложной причине.
 */

const ROUTE = readFileSync('src/app/api/applications/route.ts', 'utf8');

test('INSERT в applications существует', () => {
  assert.ok(ROUTE.includes('INSERT INTO applications'));
});

test('letter_id записывается из вычисленного selectedLetterId', () => {
  // В блоке .run(...) после selectedLetterId должен идти origin и message,
  // а не data.letterId. origin стоит между ними с Фазы 1 (происхождение).
  assert.ok(
    /selectedLetterId,\s*origin,\s*message,/.test(ROUTE),
    'letter_id должен записываться из selectedLetterId',
  );
  assert.ok(
    !/data\?\.letterId\s*\?\?\s*null,\s*message/.test(ROUTE),
    'letter_id из тела запроса не должен попадать в INSERT',
  );
});

/*
 * Эти две проверки раньше требовали `resumeIdUsed` — локальный `resumes.id`.
 * Это было неверно: колонка объявлена как идентификатор резюме НА hh, и именно
 * его читают потребители (`resumes.hh_id = a.resume_id` в resume-variants,
 * поиск по hh_id в api/applications/[id]/interview). Локальный номер туда
 * положить нельзя — сравнение `hh_id = '7'` против строки не найдёт ничего,
 * а `hh_id = 7` против строки найдёт ЧУЖОЕ резюме с тем же номером. Поэтому
 * проверка ниже фиксирует контракт «записан тот же идентификатор, что ушёл в
 * hh.ru», а поведение проверяется по-настоящему в applications-resume-id.
 */

test('resume_id записывается из идентификатора, который ушёл в hh', () => {
  assert.ok(
    /hhResumeId\s*\?\?\s*null,\s*selectedLetterId,/.test(ROUTE),
    'в applications.resume_id должен попадать hhResumeId — тот же, что отправлен в hh',
  );
  assert.ok(
    !/data\?\.resumeId\s*\?\?\s*null,\s*selectedLetterId,/.test(ROUTE),
    'resume_id из тела запроса не должен попадать в INSERT',
  );
  assert.ok(
    !/resumeIdUsed/.test(ROUTE),
    'локальный resumes.id не должен попадать в applications.resume_id',
  );
});

test('выбор резюме даёт hh_id, с откатом на общее подключение аккаунта', () => {
  assert.ok(
    /let hhResumeId[^=]*=\s*\(resumeRow\?\.hh_id\s*\?\?\s*""\)\.trim\(\)\s*\|\|\s*null/.test(ROUTE),
    'идентификатор берётся из hh_id фактически выбранного резюме',
  );
  assert.ok(
    /hhResumeId\s*=\s*fresh\.hh_resume_id\?\.trim\(\)\s*\|\|\s*null/.test(ROUTE),
    'если у выбранного резюме нет привязки, берётся общее users.hh_resume_id',
  );
  assert.ok(
    ROUTE.includes('ORDER BY updated_at DESC LIMIT 1'),
    'при автовыборе берётся последнее обновлённое резюме',
  );
});

test('персонализированное письмо сохраняется и отправляется одно и то же', () => {
  assert.ok(
    /message\s*=\s*\(await personalizeLetter\(template, vacancy, resumeContent\)\)\.content/.test(
      ROUTE,
    ),
    'персонализация использует выбранное письмо',
  );
  assert.ok(
    /message:\s*message\s*\|\|\s*undefined/.test(ROUTE),
    'в hh.ru уходит то же сообщение, что сохраняется в БД',
  );
  assert.ok(
    /selectedLetterId,\s*origin,\s*message,/.test(ROUTE),
    'в БД сохраняется то же message, что отправлено в hh.ru',
  );
});

test('выбранный letterId валидируется на принадлежность пользователю', () => {
  // Чужой letterId должен отбрасываться, а не записываться в applications.
  assert.ok(
    /selectedLetterId\s*!=\s*null\s*&&\s*!letters\.some/.test(ROUTE),
    'неизвестный letterId сбрасывается в null',
  );
});
