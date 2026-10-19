import test from 'node:test';
import assert from 'node:assert/strict';
import {
  responseForHhState,
  isClosedState,
  isReviewedNegotiation,
  hhStateLabel,
} from '../src/lib/hh-states';

/**
 * Соответствие состояний hh.ru внутренним статусам.
 *
 * Регрессия: модуль утверждал, что соответствие «взято из документации
 * hh.ru», и содержал состояния, которых у соискателя на площадке НЕТ.
 * Живой словарь `GET /dictionaries`, ключ `negotiations_state`, отдаёт ровно
 * шесть: response, invitation, discard, hidden, interview, hired.
 *
 * Из них в таблице соответствия был только `invitation`. Остальные пять
 * попадали в «нет ответа», а отказ (`discard`) не был ещё и в CLOSED_STATES.
 *
 * Что это значило на живых данных:
 *  - «Отказы» в статистике равнялись нулю ВСЕГДА — ветка записи
 *    `status='declined'` была недостижима;
 *  - приглашение на собеседование (`interview`) и «Выход на работу» (`hired`)
 *    записывались как отсутствие реакции;
 *  - VIEWED_STATES состоял из выдуманных id, поэтому `viewed_at` не писался
 *    никогда и «Просмотрено» было нулём.
 *
 * Тесты ниже сверяются с реальным словарём площадки, а не с предположением о
 * нём: это единственный способ не повторить ту же ошибку через год.
 */

/** Состояния из живого ответа hh.ru/dictionaries → negotiations_state. */
const REAL_HH_STATES = [
  'response',
  'invitation',
  'discard',
  'hidden',
  'interview',
  'hired',
] as const;

/**
 * Отказ распознаётся, и закрытым считается только он.
 *
 * `discard` — единственное состояние, означающее «работодатель отказал».
 */
test('единственный настоящий отказ площадки — discard', () => {
  assert.equal(
    responseForHhState('discard'),
    'decline',
    'отказ на hh не распознан — «Отказы» в статистике останутся нулевыми',
  );
  assert.ok(isClosedState('discard'), 'discard не считается закрытым');
});

test('приглашение и собеседование распознаются как приглашение', () => {
  for (const state of ['invitation', 'interview']) {
    assert.equal(
      responseForHhState(state),
      'interview',
      `«${state}» — реальное состояние площадки, но не приглашение`,
    );
    assert.ok(!isClosedState(state), `«${state}» засчитано как закрытие`);
  }
});

test('выход на работу — сильнейший исход, а не «нет ответа»', () => {
  assert.equal(
    responseForHhState('hired'),
    'interview',
    'наняли, а в статистике «нет ответа» — самый обидный вид неправды',
  );
});

test('скрытая переписка не отказ и не ответ', () => {
  /*
   * `hidden` — действие соискателя или площадки (настройки видимости),
   * а не решение работодателя. Засчитать его отказом значило бы писать в
   * статистику то, чего не было.
   */
  assert.equal(responseForHhState('hidden'), '');
  assert.ok(!isClosedState('hidden'), 'скрытая переписка засчитана как отказ');
});

test('свежий отклик без реакции — пустой статус', () => {
  assert.equal(responseForHhState('response'), '');
  assert.ok(!isClosedState('response'));
});

/**
 * Главный тест файла: НИ ОДНОГО состояния реального словаря не должно
 * молча превращаться в «нет ответа».
 *
 * Именно это и произошло раньше: пять состояний из шести не были описаны.
 */
test('каждое реальное состояние словаря описано явно', () => {
  for (const state of REAL_HH_STATES) {
    const known = state === 'response' || state === 'hidden' || REAL_HH_STATES.includes(state);
    assert.ok(known, `состояние «${state}» выпало из рассмотрения`);
  }
  // Смысл проверки: для каждого состояния ответ известен заранее.
  const expected: Record<string, string> = {
    response: '',
    invitation: 'interview',
    discard: 'decline',
    hidden: '',
    interview: 'interview',
    hired: 'interview',
  };
  for (const [state, want] of Object.entries(expected)) {
    assert.equal(responseForHhState(state), want, `состояние «${state}»: ожидалось «${want}»`);
  }
});

/**
 * Состояния, которых у соискателя на hh нет, но которые были в таблице.
 *
 * Список зафиксирован намеренно. Если кто-то снова внесёт их «на всякий
 * случай», тест покажет, что внесено то, чего площадка не отдаёт, — то есть
 * баг, из-за которого отказы и просмотры были нулевыми.
 */
test('несуществующие на стороне соискателя состояния не маскируются под реальные', () => {
  const invented = ['viewed', 'rejected', 'discarded', 'declined', 'screening', 'invited', 'offer'];
  for (const state of invented) {
    assert.ok(
      !REAL_HH_STATES.includes(state as (typeof REAL_HH_STATES)[number]),
      `«${state}» вдруг стал настоящим состоянием — обновите соответствие`,
    );
  }
  // И они не должны влиять на результат: неизвестное = «нет ответа».
  for (const state of invented) {
    assert.equal(responseForHhState(state), '', `выдуманное «${state}» истолковано как результат`);
    assert.ok(!isClosedState(state), `выдуманное «${state}» засчитано как закрытие`);
  }
});

test('неизвестное состояние не превращается в отказ', () => {
  /*
   * Площадка добавляет состояния. Неизвестное должно означать «нет
   * реакции», а не «отказ»: иначе появление нового состояния на hh
   * молча испортило бы статистику у всех пользователей разом.
   */
  for (const state of ['что-то_новое', 'some_new_state', '', null, undefined]) {
    assert.equal(
      responseForHhState(state),
      '',
      `неизвестное состояние «${state}» истолковано как результат`,
    );
    assert.ok(!isClosedState(state), `«${state}» засчитано как закрытие`);
  }
});

/**
 * «Рассмотрено» приходит флагом в теле переписки, а не состоянием.
 *
 * У hh НЕТ состояния «резюме посмотрели» — среди шести состояний словаря
 * такого нет, и площадка не отдаёт соискателю факт открытия резюме.
 * Единственный честный признак, что работодатель дошёл до рассмотрения, —
 * `reviewed`. Называть его «просмотром» нельзя, поэтому и в коде, и в UI
 * это «рассмотрено».
 */
test('рассмотрение определяется флагом reviewed, а не догадкой о состоянии', () => {
  assert.equal(isReviewedNegotiation(true), true);
  for (const value of [false, undefined, null, 0, 1, 'true', '']) {
    assert.equal(
      isReviewedNegotiation(value),
      false,
      `значение ${JSON.stringify(value)} принято за «рассмотрено»`,
    );
  }
});

test('причина отказа сохраняется текстом', () => {
  // hh присылает причину в state.name, и именно она объясняет пользователю,
  // что не сработало. Раньше причина терялась: сохранялось «interview».
  assert.equal(hhStateLabel('discard'), 'discard');
  assert.equal(hhStateLabel(null), null);
});
