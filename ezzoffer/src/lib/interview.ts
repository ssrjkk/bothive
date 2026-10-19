import { extractSkills } from './skills';
import { scoreVacancyForResume } from './ai-matching';
import type { Vacancy } from './vacancies/types';

/**
 * Подготовка к собеседованию.
 *
 * Человеку приходит приглашение, и у него часы. Что реально помогает за эти
 * часы — не общий список «расскажите о себе», а вопросы, которые следуют из
 * ЭТОЙ вакансии и из ЕГО резюме, плюс места, где его спросят о том, чего в
 * резюме нет.
 *
 * Модуль работает без внешних сервисов. Если задан AI_API_KEY, `ai.ts`
 * используется отдельно и по-другому — здесь основной путь сознательно
 * детерминированный: он должен работать всегда, когда работает сервис, и не
 * молчать из-за лимита или сети.
 */

export type QuestionCategory =
  'achievement' | 'about-you' | 'experience' | 'skills' | 'gaps' | 'company' | 'salary';

export type InterviewQuestion = {
  category: QuestionCategory;
  question: string;
  /** Подсказка, что спросят и на что обратить внимание. */
  hint: string;
};

export type InterviewPrep = {
  questions: InterviewQuestion[];
  /** Навыки из вакансии, которых нет в резюме. О них спросят почти наверняка. */
  riskyGaps: string[];
  /** Навыки, которые стоит проговорить в первую очередь. */
  strongCards: string[];
  /** Строки резюме с измеримым результатом — по ним приходит уточняющий вопрос. */
  achievements: string[];
  /** Что взять с собой. */
  checklist: string[];
};

/**
 * Вопросы по вакансии и резюме.
 *
 * Порядок разделов повторяет реальный ход собеседования: сначала «расскажите
 * о себе», затем опыт, затем конкретные технологии, затем то, чего в резюме
 * нет (об этом почти всегда спрашивают), и в конце — о компании и зарплате.
 */
export function prepareInterview(
  vacancy: Pick<Vacancy, 'title' | 'company' | 'about' | 'requirements' | 'level'>,
  resumeContent: string,
  resumeTitle = '',
): InterviewPrep {
  const scored = scoreVacancyForResume(
    {
      slug: '',
      source: 'local',
      source_id: '',
      title: vacancy.title,
      company: vacancy.company,
      salary: '',
      salary_min: null,
      salary_max: null,
      level: vacancy.level,
      format: 'В офисе',
      city: '',
      posted: '',
      published_at: null,
      category: '',
      about: vacancy.about,
      responsibilities: [],
      requirements: vacancy.requirements,
      bonus: [],
      source_url: null,
      contact_email: null,
      contact_phone: null,
    },
    resumeContent,
    resumeTitle || vacancy.title,
  );

  const riskyGaps = scored.missingSkills;
  const strongCards = scored.matchedSkills;
  const vacancySkills = extractSkills(
    `${vacancy.title} ${vacancy.about} ${vacancy.requirements.join(' ')}`,
  );

  const questions: InterviewQuestion[] = [];
  const achievements = extractAchievements(resumeContent);

  // 0. Разбор достижений — первыми, потому что это единственная часть
  // подготовки, которую невозможно подсмотреть в день собеседования.
  //
  // Человек знает, что написал «сократил на 40%», но обычно не помнит, как
  // именно: что было до, что меряли, почему выбрали это решение. Вопрос
  // приходит на собеседовании, и пауза на нём стоит дороже всего остального.
  for (const a of achievements) {
    questions.push({
      category: 'achievement',
      question: `В резюме у вас: «${a}». Расскажите, как это получилось: что было до, что мерили и почему выбрали именно это решение.`,
      hint:
        'Приготовьте три цифры: до, после и чем мерили. Если мерили не вы, ' +
        'скажите прямо — интервьюер уточнит, чем мерили они.',
    });
  }

  // 1. О себе — но привязанный к позиции, а не общий.
  questions.push({
    category: 'about-you',
    question:
      strongCards.length > 0
        ? `Расскажите о себе через то, что пересекается с этой вакансией: ${strongCards
            .slice(0, 3)
            .join(', ')}.`
        : `Расскажите о себе так, чтобы это было про позицию «${vacancy.title}».`,
    hint:
      'Опыт в порядке убывания релевантности. Первые два предложения — про то, ' +
      'что совпадает с этой вакансией, иначе первые секунды уходят в историю.',
  });

  // 2. По опыту — из требований, а не абстрактно.
  if (vacancy.requirements.length > 0) {
    const requirement = vacancy.requirements[0]!;
    questions.push({
      category: 'experience',
      question: `Расскажите про задачу из вашего опыта, ближайшую к этому: «${requirement.slice(0, 120)}».`,
      hint:
        'Структура: задача → что делали → измеримый результат. «Улучшил процесс» ' +
        'не считается результатом — нужна цифра.',
    });
  }

  // 3. По ключевым технологиям вакансии.
  for (const skill of vacancySkills.slice(0, 4)) {
    questions.push({
      category: 'skills',
      question: `Как вы применяли ${skill} на практике? Где именно и с каким результатом?`,
      hint:
        'Спрашивают не «знаете ли вы», а «делали ли вы». Отличие «читал» и «делал» ' +
        'слышно сразу.',
    });
  }

  // 4. Пробелы — самая ценная часть.
  /*
   * Об этом почти всегда спрашивают, и почти всегда это то, чего человек не
   * ждёт. Наличие самого списка заранее снимает паузу и даёт честный ответ:
   * «не работал, но вот как подошёл бы». Гораздо хуже — услышать вопрос
   * впервые на собеседовании.
   */
  for (const gap of riskyGaps.slice(0, 3)) {
    questions.push({
      category: 'gaps',
      question: `В вакансии есть ${gap}, а в резюме его нет. С чем вы работали рядом?`,
      hint:
        'Не оправдывайтесь. Покажите ближайшее: похожий инструмент, задачу, где ' +
        'навык был не нужен. Честное «нет, но вот что делаю» ценится выше блефа.',
    });
  }

  // 5. О компании.
  questions.push({
    category: 'company',
    question: `Что вы знаете о ${vacancy.company} и чем эта позиция отличается от похожих?`,
    hint:
      'Перед собеседованием: чем компания зарабатывает, кто конкуренты, что ' +
      'изменилось за год. Один конкретный факт из публичного источника звучит ' +
      'сильнее трёх общих фраз.',
  });

  // 6. Зарплата.
  questions.push({
    category: 'salary',
    question: 'Какие у вас зарплатные ожидания и что вы можете обсудить?',
    hint:
      'Называйте вилку, а не одно число, и назовите раньше, чем спросят: тот, ' +
      'кто первым произнёс цифру, задаёт рамку. Говорите «ожидаю» и сразу ' +
      'добавляйте, что важно, если цифра не совпадёт.',
  });

  return {
    questions,
    riskyGaps,
    strongCards,
    achievements,
    checklist: buildChecklist(vacancy),
  };
}

/**
 * Достижения из резюме — строки с измеримым результатом.
 *
 * Персонализация, которой не хватало. Раньше резюме влияло на подготовку
 * только через подсчёт совпадений навыков, а сами вопросы строились по вакансии
 * — для резюме «React» и «Python» набор вопросов выходил практически
 * одинаковым. То есть обещание «подготовим под ваше резюме» не обеспечивалось.
 *
 * Строка с числом — это почти всегда достижение, и именно по нему задают
 * уточняющий вопрос: назвать цифру легко, объяснить, как она получена и что
 * было альтернативой, — нет. Готовить надо именно этот разбор.
 *
 * Отсеиваются короткие строки (обычно это «Опыт: 6 лет» и заголовки) и строки
 * без цифр (тезисы без результата).
 */
export function extractAchievements(resumeContent: string, limit = 3): string[] {
  return (
    (resumeContent ?? '')
      .split(/\r?\n/)
      .map((l) => l.replace(/^[-•*—\s]+/, '').trim())
      // Нижняя граница отсекает обрывки вроде «Python 3», верхняя — абзацы, где
      // цифра встречается случайно и вопрос «как это получилось» бессмыслен.
      .filter((l) => l.length >= 20 && l.length <= 220)
      .filter((l) => /\d/.test(l))
      // Телефон содержит цифры и проходит по длине, но достижением не является.
      .filter((l) => !/(^|\D)(\+7|8)[\s(-]*\d{3}/.test(l))
      // Стаж — исходные данные, а не результат: «Опыт: 8 лет разработки»
      // нечего «рассказывать, как это получилось».
      .filter((l) => !/опыт[а-я]*[:\s]*(около\s*)?\d+\s*(год|лет|года)/i.test(l))
      .slice(0, limit)
  );
}

/** Что взять с собой и что иметь под рукой. */
function buildChecklist(vacancy: Pick<Vacancy, 'title' | 'company'>): string[] {
  return [
    'Свежая версия резюме — на телефоне и на бумаге',
    'Ссылка на это резюме в hh: объясните, что отклик оттуда',
    `Заметка о ${vacancy.company}: чем занимается, что смотрели до собеседования`,
    'Два-три вопроса к компании — их отсутствие читается как неинтерес',
    'Зарплатные ожидания: вилка и то, чем готовы пожертвовать',
  ];
}

/**
 * Разбор вакансии: что именно будут проверять.
 *
 * Отдельная функция, а не поле в prepareInterview, потому что её вывод
 * показывается в двух разных местах (карточка отклика и страница подготовки),
 * и пересчитывать анализ дважды незачем.
 */
export function vacancyBrief(vacancy: Vacancy, resumeContent: string, resumeTitle: string) {
  const scored = scoreVacancyForResume(vacancy, resumeContent, resumeTitle);
  const factors = scored.factors.map((f) => ({
    label: f.label,
    earned: f.earned,
    max: f.max,
    detail: f.detail,
  }));

  return {
    score: scored.score,
    factors,
    matched: scored.matchedSkills,
    missing: scored.missingSkills,
    /*
     * Первая фраза требований — самая цитируемая на собеседовании: её почти
     * всегда используют как основу первого технического вопроса.
     */
    leadRequirement: vacancy.requirements[0] ?? null,
  };
}
