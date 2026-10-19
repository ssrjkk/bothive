import { mainKeyboard, commandKeyboard, keyboardFor, DYNAMIC_LABELS } from './telegram-keyboard';

// Реэкспорт: клавиатуры живут в отдельном модуле, но это часть бота, и
// потребители (тесты, превью) обращаются к telegram-bot.
export { mainKeyboard, commandKeyboard, keyboardFor };

import { db, type User } from './db';
import { getStats } from './stats';
import { isPlanActive, planLabel } from './plans';
import { getCatalog, getVacancyBySlug } from './vacancies';
import { prepareInterview } from './interview';
import { nextActions } from './pipeline';
import { matchesSearch, skillsByVacancy } from './matcher';
import { applyToVacancy, getUserResumes, blockedUntil, blockedReason } from './autoapply';
import { rankVacancies } from './resume-targeting';
import { DEMO_MODE_BRIEF, isLiveMode } from './user-mode';
import type { Vacancy } from './vacancies/types';
import {
  sendTelegramMessage,
  unlinkChat,
  userByChatId,
  linkChatByCode,
  answerCallbackQuery,
  editTelegramMessage,
  escapeHtml,
  type InlineKeyboard,
} from './telegram';
import { BOT_COMMANDS, BOT_MESSAGES } from './bot-data';
import { computeSkillGaps } from './skill-gaps';
import { findGigs } from './gigs';
import { learningPath } from './learning-paths';

/**
 * Обработчик апдейтов Telegram.
 *
 * Команды бот исполняет через те же функции, что и кабинет (getStats, matchesSearch,
 * флаг autoapply_paused), поэтому цифры в чате и на сайте всегда совпадают.
 */

export type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: { id?: number | string };
    text?: string;
    from?: { first_name?: string; username?: string };
  };
  /**
   * Нажатие кнопки под сообщением.
   *
   * Отдельный вид апдейта: у него нет `text`, и без этой ветки бот молчал бы
   * на любое нажатие. Для человека это выглядит как сломанная кнопка.
   */
  callback_query?: {
    id?: string;
    data?: string;
    message_id?: number;
    chat?: { id?: number | string };
    message?: { message_id?: number; chat?: { id?: number | string } };
  };
};

/**
 * Защита от повторной обработки апдейта.
 *
 * Telegram ретраит доставку при не-2xx ответе, поэтому один и тот же update_id
 * может прийти несколько раз. Без проверки команда выполнялась повторно: для
 * /связать это не страшно (код одноразовый), а вот уведомления и статистика
 * рассылались бы дважды.
 *
 * Храним последние обработанные id в памяти процесса: update_id у Telegram
 * монотонно возрастает, поэтому достаточно отсекать всё, что уже встречалось.
 *
 * Память подкреплена таблицей meta: при рестарте процесса множество
 * восстанавливается из неё. Без этого окно повтора открывалось на каждый
 * рестарт — а рестарты здесь регулярны (деплой, планировщик, падения).
 * Задержанный ретрай Telegram после рестарта обрабатывался как новый апдейт:
 * команда выполнялась второй раз.
 *
 * Запись в meta идёт на каждый НОВЫЙ апдейт — это одна вставка на сообщение,
 * для локального SQLite дёшево. Семантика та же, что была: последние 1000 id.
 */
const seenUpdates = new Set<number>();
const SEEN_UPDATES_LIMIT = 1000;
const SEEN_UPDATES_META_KEY = 'tg:seen-updates';
let seenUpdatesLoaded = false;

function loadSeenUpdates(): void {
  if (seenUpdatesLoaded) return;
  seenUpdatesLoaded = true;
  try {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(SEEN_UPDATES_META_KEY) as
      { value: string } | undefined;
    if (!row?.value) return;
    const ids = JSON.parse(row.value) as unknown;
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (typeof id === 'number' && Number.isFinite(id)) seenUpdates.add(id);
    }
  } catch {
    // Нет таблицы, битый JSON — начинаем с пустого множества, как раньше.
  }
}

function persistSeenUpdates(): void {
  try {
    db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(SEEN_UPDATES_META_KEY, JSON.stringify([...seenUpdates].slice(-SEEN_UPDATES_LIMIT)));
  } catch {
    // Защита от повторов — не условие обработки: молча пропускаем.
  }
}

/** Возвращает false, если апдейт уже обрабатывался. */
export function markUpdateSeen(updateId: number | undefined): boolean {
  if (updateId === undefined) return true;
  loadSeenUpdates();
  if (seenUpdates.has(updateId)) return false;
  seenUpdates.add(updateId);
  // Сдерживаем рост памяти: при переполнении вытесняем самые старые записи.
  if (seenUpdates.size > SEEN_UPDATES_LIMIT) {
    const excess = seenUpdates.size - SEEN_UPDATES_LIMIT;
    let removed = 0;
    for (const id of seenUpdates) {
      seenUpdates.delete(id);
      if (++removed >= excess) break;
    }
  }
  persistSeenUpdates();
  return true;
}

/** Сброс для тестов. */
export function resetSeenUpdates(): void {
  seenUpdates.clear();
  seenUpdatesLoaded = true;
  try {
    db.prepare('DELETE FROM meta WHERE key = ?').run(SEEN_UPDATES_META_KEY);
  } catch {
    // Тестовая БД без meta — нечего чистить.
  }
}

export type Reply = {
  text: string;
  action?: BotAction;
  /** Кнопки под сообщением; undefined — сообщение без кнопок. */
  keyboard?: InlineKeyboard;
};

/**
 * Что команда должна сделать помимо текста.
 *
 * Раньше здесь были только `link` и `unlink`, а `/пауза` и `/отклик`
 * отвечали текстом, не выполняя обещанного. Сайт при этом рекламировал
 * «Мгновенная остановка» и «Отклик с персонализацией».
 */
export type BotAction =
  | 'link'
  | 'unlink'
  | 'pause'
  | 'resume'
  | { kind: 'apply'; vacancy: Vacancy }
  | { kind: 'interview'; page: number }
  | { kind: 'bookmarks'; page: number }
  | { kind: 'tips' };

/** Сколько вопросов помещается в одно сообщение. */
const INTERVIEW_PAGE = 3;

/** Сколько вакансий помещается в одно сообщение избранного. */
const BOOKMARK_PAGE = 6;

/**
 * Последний отклик, к которому есть вакансия в каталоге.
 *
 * Берётся последний: человек готовится к тому, куда его позвали или куда он
 * только что откликнулся, а не к произвольному отклику трёхдневной давности.
 */
/*
 * Алиас `resume_id AS resumeId` — не косметика.
 *
 * Здесь был `SELECT job_slug AS slug, resume_id`, а тип объявлялся как
 * `{ slug: string; resumeId: string | null }`. Приведение типа в TypeScript не
 * проверяется, поэтому ошибка прошла компиляцию: в объекте лежал
 * `resume_id`, а читался `last.resumeId` — всегда `undefined`.
 *
 * Дальше `resumeForPrep(user.id, undefined)` молча уходил на «последнее
 * обновлённое резюме». То есть подготовка к собеседованию из Telegram всегда
 * строилась не по тому резюме, которое компания видела, а по случайному, и
 * человек об этом не узнавал: вопросы выглядят осмысленно, просто чужие.
 *
 * Ровно та же ошибка была в api/applications/[id]/interview, там её
 * исправили, а до телеграма не добрались.
 */
function lastApplicable(userId: number): { slug: string; resumeId: string | null } | null {
  return (
    (db
      .prepare(
        `SELECT job_slug AS slug, resume_id AS resumeId FROM applications
         WHERE user_id = ? AND withdrawn = 0
         ORDER BY sent_at DESC LIMIT 1`,
      )
      .get(userId) as { slug: string; resumeId: string | null } | undefined) ?? null
  );
}

/** Резюме, отправленное в этом отклике, с откатом на последнее обновлённое. */
function resumeForPrep(
  userId: number,
  hhId: string | null,
): { title: string; content: string } | null {
  const found = (
    hhId
      ? db
          .prepare('SELECT title, content FROM resumes WHERE user_id = ? AND hh_id = ?')
          .get(userId, hhId)
      : undefined
  ) as { title: string; content: string } | undefined;
  if (found) return found;
  return (
    (db
      .prepare(
        'SELECT title, content FROM resumes WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
      )
      .get(userId) as { title: string; content: string } | undefined) ?? null
  );
}

/**
 * Подготовка к собеседованию по последнему отклику.
 *
 * Считается той же функцией, что и на сайте, — вопросы строятся из вакансии и
 * из того резюме, которое компания уже видела, а не из общего списка. Разница
 * между «вопросы к вакансии» и «вопросы к вашему резюме на эту вакансию» ровно
 * та, ради которой подготовка вообще нужна.
 */
function interviewReply(user: User, page: number): Reply {
  const last = lastApplicable(user.id);
  if (!last) {
    return {
      text: [
        'Пока нечего готовить — нет ни одного отклика.',
        '',
        'Сначала отправьте отклик: /подбор, затем кнопка под вакансией. После этого здесь появятся вопросы именно по вашему резюме на эту позицию.',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  const vacancy = getVacancyBySlug(last.slug);
  if (!vacancy) {
    return {
      text: [
        'Последний отклик — на вакансию, которой больше нет в каталоге.',
        '',
        'Скорее всего, её сняли на hh. Подготовьтесь к следующей: /подбор.',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  const resume = resumeForPrep(user.id, last.resumeId);
  if (!resume) {
    return {
      text: [
        'Нет резюме — готовиться не к чему.',
        '',
        'Добавьте резюме в кабинете: /dashboard/resumes. Подготовка строится по нему.',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  const prep = prepareInterview(vacancy, resume.content, resume.title);
  const pages = Math.max(1, Math.ceil(prep.questions.length / INTERVIEW_PAGE));
  const safePage = Math.min(Math.max(1, page), pages);
  const from = (safePage - 1) * INTERVIEW_PAGE;
  const chunk = prep.questions.slice(from, from + INTERVIEW_PAGE);

  const lines = [
    `<b>Собеседование: ${escapeHtml(vacancy.title)}</b>`,
    escapeHtml(vacancy.company),
    '',
  ];

  // Козыри и пробелы идут до вопросов: это то, что человек должен знать наизусть.
  if (prep.strongCards.length > 0) {
    lines.push(`<b>Сильные стороны</b>: ${escapeHtml(prep.strongCards.slice(0, 4).join(', '))}`);
  }
  if (prep.riskyGaps.length > 0) {
    lines.push(
      `<b>Спросят, а в резюме нет</b>: ${escapeHtml(prep.riskyGaps.slice(0, 4).join(', '))}`,
    );
  }
  if (prep.achievements.length > 0) {
    lines.push('', '<b>Готовьте цифры</b>:');
    for (const a of prep.achievements) lines.push(`— ${escapeHtml(a)}`);
  }

  lines.push('', `<b>Вопросы ${safePage} из ${pages}</b>`);
  for (const q of chunk) {
    lines.push(`— ${escapeHtml(q.question)}`);
    lines.push(`  ${escapeHtml(q.hint)}`);
  }

  if (safePage < pages) {
    lines.push('', `Осталось вопросов: ${prep.questions.length - from - chunk.length}.`);
  }

  return {
    text: lines.join('\n'),
    keyboard: {
      inline_keyboard: [
        ...(safePage < pages
          ? [[{ text: DYNAMIC_LABELS.interviewMore, data: `interview:${safePage + 1}` }]]
          : []),
        [
          { text: 'Подбор вакансий', data: 'menu:search' },
          { text: 'Статистика', data: 'menu:stats' },
        ],
        // Выход всегда под рукой: без него со второй страницы вопросов
        // единственный путь — набирать команду вручную.
        [
          { text: 'Пауза', data: 'menu:pause' },
          { text: 'Помощь', data: 'menu:help' },
        ],
      ],
    },
  };
}

/** Вакансия из избранного по порядковому номеру на текущей странице списка. */
function resolveBookmark(userId: number, number: number): Vacancy | null {
  if (!Number.isInteger(number) || number < 1) return null;
  const row = db
    .prepare('SELECT job_slug FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as { job_slug: string }[];
  const hit = row[number - 1];
  return hit ? getVacancyBySlug(hit.job_slug) : null;
}

/** Избранное: что человек отложил, чтобы вернуться. */
function bookmarksReply(user: User, page: number): Reply {
  const rows = db
    .prepare(
      'SELECT job_slug, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(user.id) as { job_slug: string; created_at: number }[];

  if (rows.length === 0) {
    return {
      text: [
        'В избранном пусто.',
        '',
        'Откладывайте вакансии, к которым хотите вернуться, — они не исчезнут из каталога за неделю. Список отложенного: /dashboard/bookmarks.',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  const pages = Math.max(1, Math.ceil(rows.length / BOOKMARK_PAGE));
  const safePage = Math.min(Math.max(1, page), pages);
  const from = (safePage - 1) * BOOKMARK_PAGE;
  const chunk = rows.slice(from, from + BOOKMARK_PAGE);

  const lines = [`<b>Избранное</b> — ${rows.length}, страница ${safePage} из ${pages}`, ''];
  const buttons: InlineKeyboard['inline_keyboard'] = [];

  for (const [i, row] of chunk.entries()) {
    const vacancy = getVacancyBySlug(row.job_slug);
    const number = from + i + 1;
    if (!vacancy) {
      lines.push(`${number}. Вакансия убрана с площадки`);
      continue;
    }
    lines.push(`${number}. ${escapeHtml(vacancy.title)} — ${escapeHtml(vacancy.company)}`);
    buttons.push([
      { text: DYNAMIC_LABELS.bookmarkApply(number), data: `bookmarkApply:${number}` },
      { text: DYNAMIC_LABELS.bookmarkRemove, data: `bookmarkRemove:${row.job_slug}` },
    ]);
  }

  if (safePage < pages)
    buttons.unshift([{ text: DYNAMIC_LABELS.bookmarksMore, data: `bookmarks:${safePage + 1}` }]);
  buttons.push([
    { text: 'Подбор вакансий', data: 'menu:search' },
    { text: 'Пауза', data: 'menu:pause' },
  ]);

  return { text: lines.join('\n'), keyboard: { inline_keyboard: buttons } };
}

/** Что делать прямо сейчас: подсказки строятся по фактическому состоянию. */
function tipsReply(user: User): Reply {
  const actions = nextActions(user.id);
  if (actions.length === 0) {
    return {
      text: [
        'Сейчас ничего срочного: активные поиски есть, отклики идут.',
        '',
        'Посмотреть, что происходит: /статистика',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  const lines = ['<b>Что сделать сейчас</b>', ''];
  for (const action of actions.slice(0, 4)) {
    lines.push(`— ${escapeHtml(action.title)}`);
    if (action.detail) lines.push(`  ${escapeHtml(action.detail)}`);
  }
  return { text: lines.join('\n'), keyboard: mainKeyboard() };
}

/**
 * Пробелы в навыках.
 *
 * Тот же раздел, что на сайте, из тех же данных. В телефоне он полезнее, чем
 * на странице: человек узнаёт об отказе по пути на собеседование и хочет
 * понять, чего ему не хватило, не открывая ноутбук.
 *
 * Формат ограничен длиной сообщения: четыре первых пункта с объяснением и
 * одним тем, что делать по каждому. Полный список с планами — на сайте.
 */
function skillsReply(user: User): Reply {
  const report = computeSkillGaps(user.id);

  if (!report.basis.resumeFound) {
    return {
      text: [
        '<b>Что закрыть в первую очередь</b>',
        '',
        'Пока нет резюме, список не собрать: неизвестно, чего в нём не хватает.',
        'Добавьте резюме в кабинете (/dashboard/resumes) — и список соберётся сам.',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  if (report.gaps.length === 0) {
    return {
      text: [
        '<b>Что закрыть в первую очередь</b>',
        '',
        report.basis.applications > 0
          ? `Пробелов не видно: всё, что требуют вакансии из вашего подбора, уже есть в резюме. Откликов разобрано: ${report.basis.applications}.`
          : 'Пробелов не видно, но откликов пока нет — список уточнится, как только они появятся.',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  const lines = ['<b>Что закрыть в первую очередь</b>', ''];
  for (const gap of report.gaps.slice(0, 4)) {
    lines.push(`— <b>${escapeHtml(gap.skill)}</b>: ${escapeHtml(gap.reason)}`);
    const path = learningPath(gap.skill);
    if (path) lines.push(`  Первым делом: ${escapeHtml(path.topics[0]?.topic ?? path.why)}`);
  }
  if (report.gaps.length > 4) {
    lines.push('', `И ещё ${report.gaps.length - 4} — полный список с планами: /dashboard/skills`);
  } else {
    lines.push('', 'Полный список с планами: /dashboard/skills');
  }

  return { text: lines.join('\n'), keyboard: mainKeyboard() };
}

/**
 * Подработка и фриланс.
 *
 * Из телефона человек обычно ищет именно это: «подработка», «фриланс», «заказы».
 * Раздел на сайте фильтрует по направлению и грейду, здесь — два входа:
 * общий список и подработка. Направление и грейд в боте не спрашиваются, потому
 * что ввод текста с телефона дороже, чем сама вакансия; список ограничен по
 * длине сообщения, а полный — на странице.
 */
function gigsReply(user: User, mode: 'подработка' | 'фриланс' | undefined): Reply {
  const gigs = findGigs({ mode, limit: 8 });

  if (gigs.length === 0) {
    const what =
      mode === 'фриланс'
        ? 'заказов'
        : mode === 'подработка'
          ? 'подработки'
          : 'подработки и заказов';
    return {
      text: [
        `<b>${escapeHtml(cap(what))}:</b> сейчас пусто`,
        '',
        'Это факт, а не сбой: источники конечны, и пустая лента означает, что на площадках сегодня тихо.',
        'Подработка обычно появляется в течение дня. Полный каталог с фильтрами: /dashboard/gigs',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  const lines = [
    `<b>${mode === 'фриланс' ? 'Фриланс и заказы' : mode === 'подработка' ? 'Подработка' : 'Подработка и заказы'}</b>`,
    '',
  ];
  for (const [i, g] of gigs.entries()) {
    lines.push(`${i + 1}. ${escapeHtml(g.title)}`);
    const meta = [g.company, g.city, g.directionLabel, g.sourceLabel].filter(Boolean);
    if (meta.length) lines.push(`   ${escapeHtml(meta.join(' · '))}`);
  }
  lines.push(
    '',
    `Ещё ${Math.max(0, findGigs({ mode }).length - gigs.length)} в разделе: /dashboard/gigs`,
  );
  lines.push('Заказы отправляются на самой площадке — автоматической отправки нет.');

  return { text: lines.join('\n'), keyboard: mainKeyboard() };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Ставит и снимает паузу. Возвращает, изменилось ли что-то. */
function setPaused(user: User, paused: boolean): boolean {
  const result = db
    .prepare('UPDATE users SET autoapply_paused = ? WHERE id = ?')
    .run(paused ? 1 : 0, user.id);
  return result.changes > 0;
}

const HELP = [
  'Привет! Я бот EZOffer — управляю откликами из Telegram.',
  '',
  'Команды:',
  ...BOT_COMMANDS.map((c) => `/${c.command} — ${c.title.toLowerCase()}`),
  '/статистика — воронка откликов за неделю',
  '/собеседование — что спросят по вашему резюме на последнюю вакансию',
  '/избранное — отложенные вакансии',
  '/советы — что сделать прямо сейчас',
  '/навыки — чего не хватает в резюме по вашим откликам',
  '/подработка — частичная занятость и заказы с фриланс-досок',
  '/связать <код> — привязать аккаунт из кабинета',
  '/выйти — отвязать этот чат',
  '/помощь — эта справка',
  '',
  'Сначала привяжите аккаунт: «Настройки → Telegram-бот» в кабинете (/dashboard/settings).',
].join('\n');

const NOT_LINKED = [
  'Аккаунт не привязан.',
  '',
  'Чтобы связать: откройте в кабинете «Настройки → Telegram-бот» (/dashboard/settings),',
  'возьмите шестизначный код и пришлите сюда: /связать 123456',
].join('\n');

function fmt(n: number): string {
  return String(n);
}

function statsReply(user: User): string {
  const stats = getStats(user.id);
  const active = isPlanActive(user);

  if (!active) {
    return [
      `Тариф «${planLabel(user)}» истёк — автоотклики на паузе.`,
      '',
      'Продлите тариф в кабинете: /dashboard/settings',
    ].join('\n');
  }

  const lines = [
    `Тариф: ${planLabel(user)} · сегодня ${fmt(stats.today)}/${fmt(stats.todayLimit)}`,
    `Активных поисков: ${fmt(stats.activeSearches)}${user.autoapply_paused ? ' · на паузе ⏸' : ''}`,
    '',
    'За 7 дней:',
    `Отправлено ${fmt(stats.sent)} · Просмотрено ${fmt(stats.viewed)} · Ответов ${fmt(stats.responded)}`,
    '',
    `Просмотры: ${fmt(stats.viewRate)}% · Ответы: ${fmt(stats.respondRate)}% · Приглашения: ${fmt(stats.inviteRate)}%`,
  ];
  if (stats.hint) lines.push('', stats.hint);
  return lines.join('\n');
}

/**
 * Ответ на `/отклик`.
 *
 * Раньше здесь обещали «Запускаю отклики… Прогресс придёт сообщением», но
 * команда не делала ровно ничего: ни одного запроса, ни одного уведомления.
 * Человек нажимал и ждал откликов, которых не было. `notifyUser` и
 * `notifyAll` вообще не вызывались ниоткуда.
 *
 * Теперь команда работает: без номера показывает пронумерованный подбор,
 * с номером — отправляет один отклик через applyToVacancy, то есть тем же
 * кодом, что и плановый прогон.
 */
function applyReply(user: User, args: string): Reply {
  /*
   * Демо-режим отсекает раньше тарифа.
   *
   * Порядок не формальный: человеку без тарифа помогает «активируйте тариф»,
   * а человеку в демо-режиме с активным тарифом такой совет вводит в
   * заблуждение — он выполнит его и всё равно не отправит отклик. Поэтому
   * сначала режим, потом остальные препятствия.
   */
  if (!isLiveMode(user)) return { text: DEMO_MODE_BRIEF };
  if (!isPlanActive(user)) return { text: 'Сначала активируйте тариф или пробный период.' };
  if (user.autoapply_paused) {
    return { text: 'Автоотклики на паузе ⏸ Снимите паузу: /старт' };
  }

  const searches = db
    .prepare(
      'SELECT * FROM searches WHERE user_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 5',
    )
    .all(user.id) as Parameters<typeof matchesSearch>[1][];

  if (searches.length === 0) {
    return {
      text: 'Нет активных автопоисков — откликаться пока не на что. Создайте поиск: /dashboard/jobs',
    };
  }

  const catalog = getCatalog();
  const skills = skillsByVacancy(catalog);
  const resumes = getUserResumes(user.id);
  const seen = new Set<string>();
  const matched = catalog.filter(
    (v) =>
      v.source === 'hh' &&
      searches.some((s) => matchesSearch(v, s, skills.get(v.slug))) &&
      !seen.has(v.slug) &&
      seen.add(v.slug),
  );

  if (matched.length === 0) {
    return {
      text: [
        '<b>Подходящих вакансий на hh.ru пока нет.</b>',
        '',
        'Бот откликается только на вакансии hh.ru — на остальных площадках отклик делается вручную из кабинета.',
      ].join('\n'),
      keyboard: mainKeyboard(),
    };
  }

  /*
   * Нумерация — по совпадению с резюме, а не по порядку каталога.
   *
   * Иначе «/отклик 2» означал бы произвольную вакансию из выдачи (порядок
   * задаётся сортировкой по источнику и названию), и человек нажимал бы на
   * номер, не понимая, что выберет. Тот же порядок, что на сайте: сначала то,
   * что подходит лучше всего.
   */
  const ranked = rankVacancies(matched, resumes, skills);

  const index = Number(args.trim());
  if (Number.isFinite(index) && Number.isInteger(index) && index >= 1) {
    const target = ranked[index - 1]?.vacancy;
    if (!target) {
      return {
        text: `В подборе только ${ranked.length} вакансий. Нажмите «Подбор вакансий», чтобы увидеть список.`,
        keyboard: mainKeyboard(),
      };
    }
    return { text: '', action: { kind: 'apply', vacancy: target } };
  }

  /*
   * Список показывается пятью лучшими, а не всеми: под каждым заголовком в
   * подбор попадают сотни вакансий, и список на двадцать строк в чате никто не
   * не читает. Ограничение прямо названо, чтобы «показано 5» не читалось как
   * «показаны все».
   */
  const shown = ranked.slice(0, 5);
  const lines = [`<b>Подбор по вашим активным поискам</b>`, ''];
  for (const [i, r] of shown.entries()) {
    const v = r.vacancy;
    const match = r.ratio > 0 ? ` · навыков ${Math.round(r.ratio * 100)}%` : '';
    lines.push(
      `${i + 1}. ${escapeHtml(v.title)} — ${escapeHtml(v.company)}${v.salary ? ` · ${escapeHtml(v.salary)}` : ''}${match}`,
    );
  }
  if (ranked.length > shown.length) {
    lines.push('', `и ещё ${ranked.length - shown.length} — в кабинете виден полный список.`);
  }

  /*
   * Кнопки под списком, а не только команды.
   *
   * Команда «/отклик 2» требует помнить номер и угадывать, есть ли он вообще.
   * Кнопка ставит выбор рядом с названием вакансии, и промахнуться нельзя.
   */
  return {
    text: lines.join('\n'),
    keyboard: keyboardFor(
      shown.map((r) => ({ title: r.vacancy.title, company: r.vacancy.company })),
      [
        [
          { text: 'Статистика', data: 'menu:stats' },
          { text: 'Пауза', data: 'menu:pause' },
        ],
      ],
    ),
  };
}

/** Разбирает команду и аргументы: "/поиск React удалённо" -> ["поиск", "React удалённо"]. */
export function parseCommand(text: string): { command: string; args: string } | null {
  const raw = text.trim();
  if (!raw.startsWith('/')) return null;
  const [head, ...rest] = raw.split(/\s+/);
  const command = head.slice(1).split('@')[0].toLowerCase();
  return { command, args: rest.join(' ') };
}

/**
 * Пометка демо-режима (Фаза 1, задача 3: «та же пометка в боте»).
 *
 * В кабинете баннер появился, а бот молчал. Человек читает в мессенджере
 * «3 отклика, 1 приглашение» и не знает, что это демо-симуляция, а не
 * площадка. Принцип P1 требует, чтобы происхождение цифр было видно и там.
 *
 * Пометка идёт ПЕРВОЙ строкой, а не в конце: человек читает цифры раньше,
 * чем допишет до конца. Помечены текстом «демо», а не «beta» — «демо-версия»
 * читается как ограниченная функциональность и снимается как маркетинг.
 *
 * Неизвестный режим (старый пользователь без колонки mode, миграция не
 * прошла) считается НЕ live: молчать о происхождении цифр опаснее, чем
 * показать лишнюю плашку.
 */
export function withModeNotice(text: string, mode: 'demo' | 'live' | undefined): string {
  if (mode === 'live') return text;
  if (!text.trim()) return text;
  return (
    '<b>Демо-режим</b>\n' +
    'Цифры ниже демонстрационные: они не отражают ответы площадок.\n\n' +
    text
  );
}

/** Чистый расчёт ответа: без БД и сети — удобно тестировать. */
export function replyFor(command: string, args: string, user: User | null): Reply {
  switch (command) {
    case 'start':
    case 'help':
    case 'помощь':
      return { text: HELP, keyboard: commandKeyboard() };

    case 'связать':
    case 'link':
      if (!args.trim()) return { text: 'Пришлите код: /связать 123456' };
      return { text: '', action: 'link' };

    case 'выйти':
    case 'logout':
      return { text: '', action: 'unlink' };

    default:
      break;
  }

  if (!user) return { text: NOT_LINKED };

  switch (command) {
    case 'статистика':
    case 'stats':
      return { text: statsReply(user), keyboard: mainKeyboard() };
    /*
     * Подготовка к собеседованию, избранное и подсказки.
     *
     * Всё это уже было в продукте, но доступно было только из кабинета: бот
     * умел найти вакансию и отправить отклик, а дальше человек оставался один
     * перед самым интересным — что спросят. Вопросы строятся из его же резюме
     * на эту вакансию, поэтому из телефона они не хуже, чем с сайта.
     */
    case 'собеседование':
    case 'собеса':
    case 'интервью':
    case 'interview':
      return interviewReply(user, 1);
    case 'избранное':
    case 'bookmarks':
    case 'favorites':
      return bookmarksReply(user, 1);
    case 'советы':
    case 'что делать':
    case 'next':
      return tipsReply(user);
    /*
     * Пробелы в навыках — тот же раздел, что на сайте.
     *
     * Раньше «повышение квалификации» было только на странице, и в боте её не
     * было вовсе: человек узнавал об отказе и оставался без ответа, что делать
     * дальше. Теперь список собирается из тех же данных и приходит в чат.
     */
    case 'навыки':
    case 'пробелы':
    case 'учиться':
    case 'skills':
      return skillsReply(user);
    /*
     * Подработка и заказы.
     *
     * Отдельная команда, а не фильтр внутри подбора: подработка и заказ — разные
     * вещи. Заказ это разовая задача без занятости и графика, и человек, который
     * пришёл за подработкой на вечер, не должен получать список разовых заказов.
     */
    case 'подработка':
    case 'подработки':
      // Обе раздела: справка обещает «частичная занятость и заказы», и команда
      // с названием «подработка» обязана показывать оба — иначе человек уходит
      // за подработкой и не видит заказов, а потом считает, что их нет.
      return gigsReply(user, undefined);
    case 'фриланс':
    case 'заказы':
      return gigsReply(user, 'фриланс');
    /*
     * Подбор и отклик — одна команда.
     *
     * Раньше их было три: /подбор показывал сводку по поискам, /поиск делал
     * то же самое, а /отклик — отдельный список. Человек получал три разных
     * экрана на один и тот же вопрос и не мог понять, где ему откликнуться.
     *
     * Теперь: без номера — список с кнопками, с номером — отклик на вакансию
     * из этого списка. Команда одна, поведение очевидное.
     */
    case 'подбор':
    case 'поиск':
    case 'search':
    case 'отклик':
    case 'apply':
      return applyReply(user, args);
    case 'пауза':
    case 'stop':
      return { text: '', action: 'pause' };
    case 'старт':
    case 'run':
    case 'resume':
      return { text: '', action: 'resume' };
    default:
      return { text: `Не знаю команду /${command}.\n\n${HELP}`, keyboard: commandKeyboard() };
  }
}

/**
 * Нажатие кнопки под сообщением.
 *
 * Отдельная ветка, потому что у колбэка нет текста: он приходит в
 * `callback_query`, и обработчик текстовых команд его просто игнорировал бы —
 * кнопка выглядела бы рабочей и не делала ничего.
 *
 * Ответ подтверждается всегда, даже при ошибке: иначе кнопка «часит» секунд
 * десять, и человек нажимает её повторно — то есть отправляет второй отклик.
 */
async function handleCallback(update: TelegramUpdate): Promise<boolean | null> {
  const cb = update.callback_query;
  if (!cb) return null;

  const chatId = cb.chat?.id ?? cb.message?.chat?.id;
  const data = cb.data ?? '';
  if (chatId === undefined) return null;
  const chat = String(chatId);

  const user = userByChatId(chat) ?? null;
  if (!user) {
    if (cb.id) await answerCallbackQuery(cb.id, { text: 'Аккаунт не привязан' });
    return sendTelegramMessage(chat, NOT_LINKED, { keyboard: commandKeyboard(), html: true });
  }

  const [kind, value] = data.split(':');

  if (kind === 'menu') {
    const command =
      value === 'search'
        ? 'подбор'
        : value === 'stats'
          ? 'статистика'
          : value === 'interview'
            ? 'собеседование'
            : value === 'bookmarks'
              ? 'избранное'
              : value === 'pause'
                ? 'пауза'
                : value === 'resume'
                  ? 'старт'
                  : 'помощь';

    /*
     * Действие выполняется ДО правки сообщения.
     *
     * Обратный порядок был багом: правка возвращала true, обработчик на этом
     * выходил — и пауза не наступала. Кнопка выглядела работающей, а отклики
     * продолжали уходить. Ровно тот случай, который страшнее отсутствия
     * кнопки: человек нажимает «Пауза» и не получает откликов.
     */
    if (command === 'пауза' || command === 'старт') {
      if (cb.id) await answerCallbackQuery(cb.id);
      const text = togglePause(chat, command === 'пауза');
      if (cb.message_id !== undefined) {
        const changed = await editTelegramMessage(chat, cb.message_id, text, {
          keyboard: mainKeyboard(),
          html: true,
        });
        if (changed) return true;
      }
      return sendTelegramMessage(chat, text, { keyboard: mainKeyboard(), html: true });
    }

    const reply = replyFor(command, '', user);
    if (cb.id) await answerCallbackQuery(cb.id);

    const text = reply.text || HELP;
    const changed =
      cb.message_id !== undefined
        ? await editTelegramMessage(chat, cb.message_id, text, {
            keyboard: reply.keyboard,
            html: true,
          })
        : false;

    if (changed) return true;
    return sendTelegramMessage(chat, text, { keyboard: reply.keyboard, html: true });
  }

  if (kind === 'interview' && value) {
    if (cb.id) await answerCallbackQuery(cb.id);
    const reply = interviewReply(user, Number(value) || 1);
    const text = reply.text;
    const changed =
      cb.message_id !== undefined
        ? await editTelegramMessage(chat, cb.message_id, text, {
            keyboard: reply.keyboard,
            html: true,
          })
        : false;
    if (changed) return true;
    return sendTelegramMessage(chat, text, { keyboard: reply.keyboard, html: true });
  }

  if (kind === 'bookmarks' && value) {
    if (cb.id) await answerCallbackQuery(cb.id);
    const reply = bookmarksReply(user, Number(value) || 1);
    const text = reply.text;
    const changed =
      cb.message_id !== undefined
        ? await editTelegramMessage(chat, cb.message_id, text, {
            keyboard: reply.keyboard,
            html: true,
          })
        : false;
    if (changed) return true;
    return sendTelegramMessage(chat, text, { keyboard: reply.keyboard, html: true });
  }

  if (kind === 'bookmarkRemove' && value) {
    if (cb.id) await answerCallbackQuery(cb.id, { text: 'Убрано' });
    const removed = db
      .prepare('DELETE FROM bookmarks WHERE user_id = ? AND job_slug = ?')
      .run(user.id, value);
    if (removed.changes === 0) {
      return sendTelegramMessage(chat, 'Этой вакансии уже нет в избранном.', {
        keyboard: mainKeyboard(),
        html: true,
      });
    }
    const reply = bookmarksReply(user, 1);
    const text = `Убрано из избранного.\n\n${reply.text}`;
    const changed =
      cb.message_id !== undefined
        ? await editTelegramMessage(chat, cb.message_id, text, {
            keyboard: reply.keyboard,
            html: true,
          })
        : false;
    if (changed) return true;
    return sendTelegramMessage(chat, text, { keyboard: reply.keyboard, html: true });
  }

  if (kind === 'bookmarkApply' && value) {
    if (cb.id) await answerCallbackQuery(cb.id, { text: 'Отправляю…' });
    const vacancy = resolveBookmark(user.id, Number(value));
    if (!vacancy) {
      const text = 'Этой вакансии больше нет в каталоге — она убрана с площадки.';
      if (cb.message_id !== undefined) {
        await editTelegramMessage(chat, cb.message_id, text, {
          keyboard: mainKeyboard(),
          html: true,
        });
      }
      return sendTelegramMessage(chat, text, { keyboard: mainKeyboard(), html: true });
    }
    return runApplyFromChat(chat, vacancy, cb.message_id);
  }

  if (kind === 'apply' && value) {
    if (cb.id) await answerCallbackQuery(cb.id, { text: 'Отправляю…' });
    const reply = applyReply(user, value);
    const action = reply.action;
    // Сужение именно по kind: после появления других объектных действий
    // проверка «typeof === object» больше ничего не отсекала.
    if (!action || typeof action !== 'object' || action.kind !== 'apply') {
      const text = reply.text || 'Не удалось выбрать вакансию.';
      if (cb.message_id !== undefined) {
        await editTelegramMessage(chat, cb.message_id, text, {
          keyboard: mainKeyboard(),
          html: true,
        });
      }
      return sendTelegramMessage(chat, text, { keyboard: mainKeyboard(), html: true });
    }
    return runApplyFromChat(chat, action.vacancy, cb.message_id);
  }

  if (cb.id) await answerCallbackQuery(cb.id, { text: 'Кнопка устарела' });
  return sendTelegramMessage(chat, 'Эта кнопка из старого сообщения. Откройте подбор заново.', {
    keyboard: mainKeyboard(),
    html: true,
  });
}

/**
 * Обрабатывает один апдейт Telegram.
 * Возвращает результат отправки ответа (true — сообщение ушло).
 */
export async function handleUpdate(update: TelegramUpdate): Promise<boolean | null> {
  // Telegram повторно доставляет апдейт при не-2xx ответе; обрабатывать его
  // второй раз нельзя, иначе пользователь получит дубликат ответа.
  if (!markUpdateSeen(update.update_id)) return null;

  if (update.callback_query) return handleCallback(update);

  const chatId = update.message?.chat?.id;
  const text = update.message?.text;
  if (chatId === undefined || !text) return null;

  const chat = String(chatId);
  const parsed = parseCommand(text);

  // Первое сообщение без команды — тоже приглашение.
  if (!parsed) {
    return sendTelegramMessage(chat, `Пришлите команду, например /start.\n\n${HELP}`);
  }

  const replyingUser = userByChatId(chat) ?? null;
  const reply = replyFor(parsed.command, parsed.args, replyingUser);

  if (reply.action === 'link') {
    const linked = linkChatByCode(chat, parsed.args);
    if (!linked) {
      return sendTelegramMessage(
        chat,
        'Код не подошёл: он мог истечь или уже использован.\nВозьмите свежий код в кабинете: /dashboard/settings',
      );
    }
    return sendTelegramMessage(
      chat,
      [
        `Готово, ${linked.name || 'аккаунт'} привязан! ✅`,
        '',
        'Что доступно:',
        '— /подбор — вакансии по вашим критериям',
        '— /отклик 1 — откликнуться на вакансию №1 из подбора',
        '— /статистика — воронка откликов',
        '— /пауза и /старт — остановить и возобновить отправку',
        '',
        `Отклики отправляются по тарифу «${planLabel(linked)}» с человеческими паузами.`,
      ].join('\n'),
    );
  }

  if (reply.action === 'unlink') {
    const removed = unlinkChat(chat);
    return sendTelegramMessage(
      chat,
      removed > 0
        ? 'Чат отвязан. Привязать обратно можно в кабинете: /dashboard/settings'
        : 'Этот чат и так не был привязан.',
    );
  }

  if (reply.action === 'pause' || reply.action === 'resume') {
    if (!userByChatId(chat)) return sendTelegramMessage(chat, NOT_LINKED);
    return sendTelegramMessage(chat, togglePause(chat, reply.action === 'pause'), {
      keyboard: mainKeyboard(),
      html: true,
    });
  }

  /*
   * Отклик на конкретную вакансию.
   *
   * Единственное место, где бот отправляет отклик по прямому указанию.
   * Идёт через applyToVacancy — тот же код, что у планового прогона, поэтому
   * лимиты, паузы, подбор резюме и письмо работают одинаково.
   */
  if (reply.action && typeof reply.action === 'object' && reply.action.kind === 'apply') {
    const user = userByChatId(chat);
    if (!user) return sendTelegramMessage(chat, NOT_LINKED);
    return runApplyFromChat(chat, reply.action.vacancy);
  }

  /*
   * Пометка демо-режима ставится здесь, а не в каждом обработчике команды:
   * это единственная точка, через которую уходят ответы на /статистику,
   * /отклики, /собеседование и остальные. Пропустить её в одном из
   * десяти обработчиков легко и незаметно — здесь не пропустить.
   */
  const outgoing = withModeNotice(reply.text, replyingUser?.mode);
  return sendTelegramMessage(chat, outgoing, { keyboard: reply.keyboard, html: true });
}

/**
 * Отправка отклика и ответ в чат.
 *
 * Общая функция для команды и для кнопки: раньше это были два места, и
 * правка одного не доезжала до другого — текст про успех и про отказ
 * расходился.
 *
 * После кнопки сообщение правится на месте, а не отправляется новым: иначе
 * переписка превращалась бы в стопку одинаковых «Готово», и нужный ответ
 * уезжал бы наверх.
 */
async function runApplyFromChat(
  chat: string,
  vacancy: Vacancy,
  replaceMessageId?: number,
): Promise<boolean | null> {
  const user = userByChatId(chat);
  if (!user)
    return sendTelegramMessage(chat, NOT_LINKED, { keyboard: commandKeyboard(), html: true });

  const result = await applyToVacancy(user, vacancy);
  const opts = { keyboard: mainKeyboard(), html: true };

  if (!result.ok) {
    const text = `Не отправил: ${escapeHtml(result.error)}`;
    if (replaceMessageId !== undefined) {
      await editTelegramMessage(chat, replaceMessageId, text, opts);
    }
    return sendTelegramMessage(chat, text, opts);
  }

  const text = [
    '<b>Отклик отправлен ✅</b>',
    '',
    `Вакансия: ${escapeHtml(vacancy.title)}`,
    `Компания: ${escapeHtml(vacancy.company)}`,
    result.withLetter
      ? 'Сопроводительное письмо приложено.'
      : 'Без письма — подходящего текста не нашлось.',
  ].join('\n');

  if (replaceMessageId !== undefined) {
    const changed = await editTelegramMessage(chat, replaceMessageId, text, opts);
    if (changed) return true;
  }
  return sendTelegramMessage(chat, text, opts);
}

/**
 * Пауза и возобновление — одна функция для команды и кнопки.
 *
 * Раньше это были два места. Кнопка правила сообщение раньше, чем меняла
 * состояние, и правка возвращала true — обработчик на этом выходил, а пауза
 * не наступала. Кнопка выглядела работающей, а отклики продолжали уходить.
 * Общая функция исключает такой порядок по построению.
 */
function togglePause(chat: string, paused: boolean): string {
  const user = userByChatId(chat);
  if (!user) return NOT_LINKED;

  /*
   * Ограничение площадки не снимается кнопкой «Продолжить».
   *
   * Если бы возобновление просто разрешили, человек нажал бы кнопку, увидел
   * «Отправка возобновлена» и стал ждать откликов, которых не будет:
   * планировщик упрётся в ограничение и промолчит. Сказать правду здесь
   * важнее, чем выполнить нажатие.
   */
  if (!paused) {
    const stopUntil = blockedUntil(user.id);
    if (stopUntil > 0) {
      return [
        '<b>Пока нельзя возобновить</b>',
        '',
        blockedReason(user.id) || 'hh.ru ограничил доступ к аккаунту',
        '',
        'Отклики пойдут сами, как ограничение снимется — отдельно ничего делать не нужно. Снять его можно только на hh.ru: проверьте, нет ли там ограничений или требования подтвердить аккаунт.',
      ].join('\n');
    }
  }

  if (!paused && !isPlanActive(user)) {
    return [
      `Тариф «${planLabel(user)}» истёк — сначала продлите его.`,
      '',
      'Продлить: /dashboard/settings',
    ].join('\n');
  }

  const changed = setPaused(user, paused);
  const queued = db
    .prepare('SELECT COUNT(*) AS c FROM searches WHERE user_id = ? AND active = 1')
    .get(user.id) as { c: number };

  if (!changed) {
    return paused ? 'Автоотклики уже были на паузе.' : 'Отправка уже была включена.';
  }

  if (paused) {
    return [
      '<b>Автоотклики на паузе ⏸</b>',
      '',
      queued.c > 0
        ? `Остановлю отправку сразу. Активных поисков: ${queued.c} — на возобновлении они вернутся в очередь.`
        : 'Активных поисков нет, так что ничего не теряется.',
    ].join('\n');
  }

  return [
    '<b>Отправка возобновлена ✅</b>',
    '',
    queued.c > 0
      ? `Активных поисков: ${queued.c}. Следующий прогон — в ближайшие минуты.`
      : 'Но активных поисков нет: создайте поиск, иначе откликаться не на что.',
  ].join('\n');
}

/** Текст приветственного сообщения для превью (совпадает с /start в боте). */
export function previewGreeting(): string {
  return BOT_MESSAGES[1]?.text ?? HELP;
}
