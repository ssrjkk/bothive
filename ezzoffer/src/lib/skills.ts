/**
 * Навыки: словарь с синонимами и матчинг по границам слова.
 *
 * Зачем отдельный модуль. Подстрочный поиск по списку навыков, который стоял
 * в `ai-matching.ts` и в первом варианте `matcher.ts`, давал систематическую
 * муру:
 *
 *   "JavaScript developer" -> ложное "java"   (java внутри javascript)
 *   "Менеджер по продажам" -> ноль совпадений   (в списке только sales)
 *   любая строка с буквой "c" -> ложное "c"
 *
 * Первое отбрасывает вакансию (лишний требуемый навык), второе и третье —
 * засчитывает совпадение, которого нет. Оба искажения идут в скоринг, то есть
 * в решение «откликаться или нет», поэтому чинить приходится здесь, а не
 * косметически наверху.
 *
 * Матчинг по границам слова — тот же приём, что уже применён в
 * `resume-enhance.ts` (`hasWord`). Здесь он вынесен и усилен:
 *  - регексп срабатывает на кириллице и дефисах («ci/cd», «node.js»);
 *  - у каждого навыка есть АЛИАСЫ, включая русские: без них «Менеджер по
 *    продажам» не совпадёт ни с чем, а рынок вакансий русскоязычный.
 *
 * Словарь и логика разделены намеренно: словарь пополняется как
 * контент, логика матчинга покрыта тестами и не должна меняться при его правке.
 */

type SkillDef = {
  /** Каноническое имя — оно и попадает в отчёт перед пользователем. */
  label: string;
  /** Что считать этим навыком: английское, русское, сокращения. */
  aliases: string[];
};

/** Категория — чтобы объяснять пользователю, ЧЕГО ему не хватает. */
export type SkillCategory = 'lang' | 'framework' | 'data' | 'devops' | 'design' | 'pm' | 'other';

const SKILLS: (SkillDef & { category: SkillCategory })[] = [
  // Языки
  {
    label: 'JavaScript',
    category: 'lang',
    aliases: ['javascript', 'js', 'ecmascript', 'е javascript', 'джаваскрипт'],
  },
  { label: 'TypeScript', category: 'lang', aliases: ['typescript', 'ts', 'тайпскрипт'] },
  { label: 'Python', category: 'lang', aliases: ['python', 'питон', 'пайтон'] },
  { label: 'Java', category: 'lang', aliases: ['java', 'джава'] },
  { label: 'Go', category: 'lang', aliases: ['golang', 'go lang', 'go'] },
  { label: 'C++', category: 'lang', aliases: ['c++', 'cpp', 'си плюс плюс'] },
  { label: 'C#', category: 'lang', aliases: ['c#', 'csharp', 'си шарп'] },
  { label: 'PHP', category: 'lang', aliases: ['php', 'пхп'] },
  { label: 'Kotlin', category: 'lang', aliases: ['kotlin', 'котлин'] },
  { label: 'Swift', category: 'lang', aliases: ['swift', 'свифт'] },
  { label: 'Rust', category: 'lang', aliases: ['rust', 'раст', 'руст'] },
  { label: 'Ruby', category: 'lang', aliases: ['ruby', 'руби'] },
  { label: 'Scala', category: 'lang', aliases: ['scala', 'скала'] },
  { label: 'SQL', category: 'lang', aliases: ['sql'] },

  // Фреймворки и библиотеки
  { label: 'React', category: 'framework', aliases: ['react', 'reactjs', 'реакт', 'риакт'] },
  { label: 'Next.js', category: 'framework', aliases: ['next.js', 'nextjs', 'некст'] },
  { label: 'Vue', category: 'framework', aliases: ['vue', 'vue.js', 'vuejs', 'вью'] },
  { label: 'Angular', category: 'framework', aliases: ['angular', 'ангуляр'] },
  { label: 'Svelte', category: 'framework', aliases: ['svelte'] },
  { label: 'Node.js', category: 'framework', aliases: ['node.js', 'nodejs', 'нода', 'ноде'] },
  { label: 'Django', category: 'framework', aliases: ['django', 'джианго'] },
  { label: 'FastAPI', category: 'framework', aliases: ['fastapi'] },
  { label: 'Flask', category: 'framework', aliases: ['flask', 'фласк'] },
  { label: 'Spring', category: 'framework', aliases: ['spring', 'спринг'] },
  { label: 'Rails', category: 'framework', aliases: ['rails', 'рейлс', 'руби он рейлс'] },
  { label: 'Laravel', category: 'framework', aliases: ['laravel', 'ларавел'] },
  { label: 'Flutter', category: 'framework', aliases: ['flutter', 'флаттер'] },
  { label: 'React Native', category: 'framework', aliases: ['react native', 'react-native'] },
  { label: 'Unity', category: 'framework', aliases: ['unity', 'юнити'] },

  // Данные и хранилища
  {
    label: 'PostgreSQL',
    category: 'data',
    aliases: ['postgresql', 'postgres', 'постгрес', 'постгрэс'],
  },
  { label: 'MySQL', category: 'data', aliases: ['mysql', 'майскул'] },
  { label: 'MongoDB', category: 'data', aliases: ['mongodb', 'монго', 'монгодб'] },
  { label: 'Redis', category: 'data', aliases: ['redis', 'редис'] },
  { label: 'ClickHouse', category: 'data', aliases: ['clickhouse', 'кликхаус'] },
  {
    label: 'Elasticsearch',
    category: 'data',
    aliases: ['elasticsearch', 'эластик', 'эластиксерч'],
  },
  { label: 'Kafka', category: 'data', aliases: ['kafka', 'кафка'] },
  { label: 'Pandas', category: 'data', aliases: ['pandas', 'пандас'] },
  { label: 'NumPy', category: 'data', aliases: ['numpy'] },
  { label: 'dbt', category: 'data', aliases: ['dbt'] },

  // ML и аналитика
  {
    label: 'Machine Learning',
    category: 'data',
    aliases: ['machine learning', 'ml', 'машинное обучение'],
  },
  {
    label: 'Deep Learning',
    category: 'data',
    aliases: ['deep learning', 'глубокое обучение', 'dl'],
  },
  { label: 'PyTorch', category: 'data', aliases: ['pytorch', 'пайторч'] },
  { label: 'TensorFlow', category: 'data', aliases: ['tensorflow', 'тензорфлоу'] },
  {
    label: 'NLP',
    category: 'data',
    aliases: ['nlp', 'обработка естественного языка', 'natural language'],
  },
  {
    label: 'Computer Vision',
    category: 'data',
    aliases: ['computer vision', 'компьютерное зрение'],
  },
  { label: 'Power BI', category: 'data', aliases: ['power bi', 'powerbi', 'пауэрби'] },
  { label: 'Tableau', category: 'data', aliases: ['tableau', 'табло'] },
  {
    label: 'A/B-тесты',
    category: 'data',
    aliases: ['a/b', 'ab тест', 'сплит-тест', 'эксперимент'],
  },

  // DevOps
  { label: 'Docker', category: 'devops', aliases: ['docker', 'докер'] },
  { label: 'Kubernetes', category: 'devops', aliases: ['kubernetes', 'k8s', 'кубернетес'] },
  { label: 'Terraform', category: 'devops', aliases: ['terraform', 'терраформ'] },
  { label: 'AWS', category: 'devops', aliases: ['aws', 'amazon web services'] },
  { label: 'GCP', category: 'devops', aliases: ['gcp', 'google cloud'] },
  { label: 'Azure', category: 'devops', aliases: ['azure', 'азур'] },
  {
    label: 'CI/CD',
    category: 'devops',
    aliases: ['ci/cd', 'cicd', 'ci-cd', 'непрерывная интеграция'],
  },
  { label: 'Git', category: 'devops', aliases: ['git', 'гит'] },
  { label: 'Linux', category: 'devops', aliases: ['linux', 'линукс', 'ubuntu', 'debian'] },
  { label: 'Nginx', category: 'devops', aliases: ['nginx', 'nginx'] },
  {
    label: 'Observability',
    category: 'devops',
    aliases: ['observability', 'мониторинг', 'prometheus', 'grafana'],
  },

  // Дизайн и продукт
  { label: 'Figma', category: 'design', aliases: ['figma', 'фигма'] },
  {
    label: 'UX-исследования',
    category: 'design',
    aliases: [
      'ux research',
      'user research',
      'юзабилити',
      'исследование пользователей',
      'ux-исследования',
    ],
  },
  {
    label: 'UI-дизайн',
    category: 'design',
    aliases: ['ui design', 'ui дизайн', 'интерфейс', 'ui-дизайн'],
  },
  {
    label: 'Дизайн',
    category: 'design',
    aliases: ['дизайн', 'графический дизайн', 'промышленный дизайн', 'дизайнер', 'art director'],
  },
  {
    label: 'Прототипирование',
    category: 'design',
    aliases: ['прототип', 'прототипирование', 'prototype'],
  },
  {
    label: '3D/Моушн',
    category: 'design',
    aliases: ['3d', 'motion', 'моушн', 'анимация', 'blender'],
  },

  // Продукт и управление
  { label: 'Agile', category: 'pm', aliases: ['agile', 'гибкая методология'] },
  { label: 'Scrum', category: 'pm', aliases: ['scrum', 'скрам'] },
  { label: 'Kanban', category: 'pm', aliases: ['kanban', 'канбан'] },
  { label: 'Jira', category: 'pm', aliases: ['jira', 'джира'] },
  {
    label: 'Product Management',
    category: 'pm',
    aliases: ['product management', 'продуктовое управление', 'проджект менеджмент'],
  },
  {
    label: 'Project Management',
    category: 'pm',
    aliases: ['project management', 'управление проектами'],
  },

  // Продажи, маркетинг, HR, поддержка
  {
    label: 'Продажи',
    category: 'other',
    aliases: ['sales', 'продажи', 'продаж', 'холодные звонки'],
  },
  { label: 'B2B', category: 'other', aliases: ['b2b'] },
  { label: 'B2C', category: 'other', aliases: ['b2c'] },
  {
    label: 'Лидогенерация',
    category: 'other',
    aliases: ['lead generation', 'лидогенерация', 'лидогенерации', 'лид-генерация'],
  },
  { label: 'CRM', category: 'other', aliases: ['crm', 'битрикс24', 'amo', 'amoCRM'] },
  { label: 'SEO', category: 'other', aliases: ['seo'] },
  {
    label: 'Контекстная реклама',
    category: 'other',
    aliases: ['контекст', 'директ', 'ppc', 'яндекс директ'],
  },
  {
    label: 'Таргетинг',
    category: 'other',
    aliases: [
      'таргет',
      'таргетированная',
      'таргетированной',
      'таргетированный',
      'таргетированное',
      'таргетированные',
      'таргетированных',
    ],
  },
  { label: 'SMM', category: 'other', aliases: ['smm', 'соцсети', 'социальные сети'] },
  {
    label: 'Контент-маркетинг',
    category: 'other',
    aliases: ['контент', 'копирайтинг', 'copywriting', 'контент-маркетинг'],
  },
  {
    label: 'Рекрутинг',
    category: 'other',
    aliases: ['recruiting', 'recruitment', 'рекрутинг', 'подбор персонала', 'рекрутер'],
  },
  {
    label: 'HR',
    category: 'other',
    aliases: ['hr', 'персонал', 'кадровое дело', 'кадров', 'hr-менеджер'],
  },
  {
    label: 'Финансы',
    category: 'other',
    aliases: [
      'финанс',
      'бухгалтер',
      'accounting',
      'бухгалтерия',
      'финансовый',
      'финансовая',
      'финансовое',
    ],
  },
  {
    label: 'Юриспруденция',
    category: 'other',
    aliases: ['юрист', 'юридическ', 'legal', 'юриспруденция', 'юридическая'],
  },
  {
    label: 'Поддержка',
    category: 'other',
    aliases: ['customer support', 'техподдержка', 'поддержка', 'help desk', 'поддержки'],
  },
  {
    label: 'Логистика',
    category: 'other',
    aliases: ['логистик', 'supply chain', 'закупк', 'склад', 'логист'],
  },
  {
    label: 'Аналитика',
    category: 'other',
    aliases: ['аналитик', 'data analyst', 'аналитика', 'аналитик данных', 'бизнес-аналитик'],
  },
  {
    label: 'Тестирование',
    category: 'other',
    aliases: ['тестирование', 'qa', 'тестировщик', 'автотесты', 'инженер по тестированию'],
  },
  { label: 'Маркетинг', category: 'other', aliases: ['маркетинг', 'маркетолог', 'marketing'] },
  {
    label: 'AI/ML',
    category: 'data',
    aliases: ['ai', 'ии', 'искусственный интеллект', 'ml', 'машинное обучение'],
  },
];

/** Отрендеренный регексп под каждый алиас — считается один раз при загрузке. */
type Compiled = { label: string; category: SkillCategory; re: RegExp };

/**
 * Каноническое имя добавляется алиасом всегда.
 *
 * Иначе навык не находится по собственному имени, и происходит ровно то, что
 * хуже всего: пользователь пишет в резюме «Таргетинг», а сервис сообщает «вам
 * не хватает Таргетинг», потому что в словаре лежит «таргет».
 *
 * Причина — русская морфология: «Финансы» не содержит «финанс» как отдельное
 * слово (дальше идёт «ы»), «Логистика» — «логистик», «Таргетинг» — «таргет».
 * Перечислять падежи вручную бессмысленно: форм бесконечно много, а в резюме
 * пишут именно нормативную форму. Значит нормативная форма обязана быть
 * алиасом по построению, а не по удаче словаря.
 */
/**
 * Русские падежные окончания.
 *
 * Нужны, чтобы основа навыка находилась в любом падеже: «Продажи» находит
 * алиас «продаж», «Продажам» и «Продажами» — тоже, но «реактивность»
 * (хвост «ивность») не должна давать React.
 *
 * Список не перечисляет все падежи: он покрывает хвосты, реально встречающиеся
 * после основ навыков. Первая версия была неполной и теряла «Продажам» —
 * окончания «ам» там просто не было, и это показал тест на падежные формы.
 *
 * Объявлено ДО COMPILED: модуль вычисляет регекс-последовательности при
 * загрузке, обращение к константе ниже дало бы ReferenceError.
 */
const RUSSIAN_ENDINGS = [
  'ами',
  'ями',
  'ого',
  'его',
  'ому',
  'ему',
  'ыми',
  'ими',
  'ах',
  'ях',
  'ов',
  'ев',
  'ью',
  'ья',
  'ье',
  'ей',
  'ой',
  'ый',
  'ая',
  'яя',
  'ое',
  'ее',
  'ам',
  'ям',
  'ых',
  'их',
  'ем',
  'ом',
  'ы',
  'и',
  'а',
  'я',
  'о',
  'е',
  'у',
  'ю',
  'ь',
];

/**
 * Границы слова с учётом кириллицы и точек внутри имени (node.js, ci/cd).
 *
 * `\\b` из JS не работает по-русски: он опирается на ASCII-классы
 * [A-Za-z0-9_], поэтому в «Продажи» границ у кириллических букв не находит.
 *
 * Хвост слова приходится разрешать: в «продажами» после «продаж» стоит «ами».
 * Обратная сторона — «реактивность» начинается с «реакт», и наивный хвост
 * посчитал бы её за React.
 *
 * Решение — не длина хвоста, а его категория: закрытый список падежных
 * окончаний. Всё прочее означает, что началось другое слово.
 */
function aliasRegex(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lead = `(^|[^a-zA-Zа-яА-ЯёЁ0-9])`;

  // Английский алиас: строгая граница справа. «go» не должен находиться
  // внутри «Google» или «Golang».
  if (!/[а-яА-ЯёЁ]/.test(alias)) {
    return new RegExp(`${lead}${escaped}(?![a-zA-Zа-яА-ЯёЁ0-9])`, 'iu');
  }

  /*
   * Кириллический алиас: либо сразу конец слова, либо падежное окончание.
   *
   * Конец слова — это НЕ якорь $: текст в extractSkills обёрнут пробелами,
   * поэтому $ никогда не срабатывал бы и навыки в конце строки не находились
   * (так терялись все падежные формы: «Продажам», «Финансах»).
   */
  const endings = RUSSIAN_ENDINGS.join('|');
  return new RegExp(
    `${lead}${escaped}(?=[^a-zA-Zа-яА-ЯёЁ0-9]|(?:${endings})(?![a-zA-Zа-яА-ЯёЁ0-9]))`,
    'iu',
  );
}

const COMPILED: Compiled[] = SKILLS.flatMap((s) => {
  // Сначала каноническое имя: оно самое точное совпадение, значит проверяется
  // первым и снимает вопрос про остальные алиасы этого навыка.
  const all = [s.label, ...s.aliases.filter((a) => a.toLowerCase() !== s.label.toLowerCase())];
  return all.map((alias) => ({
    label: s.label,
    category: s.category,
    re: aliasRegex(alias),
  }));
});

/**
 * Навыки в тексте.
 *
 * Порядок соответствует порядку словаря, поэтому результат детерминирован и
 * не зависит от порядка обхода объектов — на этом стоят тесты и кеш.
 */
export function extractSkills(text: string): string[] {
  if (!text) return [];
  const haystack = ` ${text} `;
  const found = new Set<string>();
  for (const c of COMPILED) {
    if (found.has(c.label)) continue; // уже нашли — не гоняем остальные алиасы
    if (c.re.test(haystack)) found.add(c.label);
  }
  return [...found];
}

/** Категория навыка — чтобы советовать «добавьте в резюме», а не «выучите c». */
export function skillCategory(label: string): SkillCategory | null {
  const entry = SKILLS.find((s) => s.label === label);
  return entry ? entry.category : null;
}

/** Все известные навыки — для тестов словаря и подсказок в интерфейсе. */
export function allSkillLabels(): string[] {
  return SKILLS.map((s) => s.label);
}

/** Разбор строки ключевых слов пользователя в навыки и свободные слова. */
export type ParsedKeywords = {
  /** Совпали со словарём — их понимаем как навыки. */
  skills: string[];
  /** Не узнали — обычные слова, ищем как есть в тексте вакансии. */
  words: string[];
};

export function parseKeywords(input: string): ParsedKeywords {
  const parts = (input ?? '')
    .split(/[,;\n]+|\s{2,}/)
    .map((t) => t.trim())
    .filter(Boolean);

  // Одиночные слова тоже берём: список из «React, TypeScript» — норма,
  // но пользователь может написать «React TypeScript».
  const raw = parts.length > 0 ? parts : (input ?? '').split(/[\s,;]+/).filter(Boolean);

  const skills = new Set<string>();
  const words: string[] = [];
  for (const part of raw) {
    const p = part.trim();
    if (!p) continue;
    const asSkills = extractSkills(p);
    if (asSkills.length > 0) {
      for (const s of asSkills) skills.add(s);
      /*
       * Слово, которое УЖЕ опознано как навык, больше не ищется как текст.
       *
       * Раньше здесь стояло исключение только для коротких слов и «чистых»
       * наборов букв: `if (p.length <= 3 || /^[a-zа-я0-9+#.]+$/iu.test(p))
       * continue;`. Из-за этого любой навык с пробелом или слэшем попадал
       * ещё и в `words`, а `matchesClause` требует ОБА условия сразу
       * (matcher.ts): навык И точное слово. То есть распознавание отменяло
       * само себя.
       *
       * Проверено на живом коде:
       *   "customer support" → skills ['Поддержка'], words ['customer support']
       *   вакансия «Поддержка клиентов» → matchesSearch = false
       *
       * Почему исключение вообще существовало: некоторые слова — и навык, и
       * обычное слово, и обычное значение нужнее («мидл», «удалённо», «middle»).
       * Но для них достаточно одного навыка: словарь содержит их синонимы.
       * Добавлять такое слово ещё и в `words` значило требовать от вакансии
       * БУКВАЛЬНОЕ «удалённо» поверх навыка — то есть ужесточать условие
       * без причины.
       *
       * Что осталось: если навык найден, литеральную проверку не делаем.
       * Если не найден — слово ищем как есть, как и раньше.
       */
      continue;
    }
    if (!words.includes(p)) words.push(p);
  }

  return { skills: [...skills], words };
}
