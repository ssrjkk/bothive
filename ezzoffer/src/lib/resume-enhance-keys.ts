/**
 * Словарь известных навыков: одно место для ATS-скоринга и для требований
 * из вакансии.
 *
 * Раньше список жил внутри resume-enhance и словаря требований не существовало.
 * Дублировать таблицу было бы верхом недосмотра: через месяц один список
 * пополнили, другой забыли, и скоринг начал бы считать разные вещи.
 */

export type Keyword = {
  /** Как навык пишет человек в резюме. */
  label: string;
  /** Что встречается в тексте вакансии: синонимы, сокращения, написания. */
  aliases: string[];
};

export const KEYWORDS: Keyword[] = [
  { label: 'JavaScript', aliases: ['javascript', 'js'] },
  { label: 'TypeScript', aliases: ['typescript', 'ts'] },
  { label: 'React', aliases: ['react'] },
  { label: 'Next.js', aliases: ['next.js', 'nextjs'] },
  { label: 'Node.js', aliases: ['node.js', 'nodejs'] },
  { label: 'Python', aliases: ['python'] },
  { label: 'Django', aliases: ['django'] },
  { label: 'FastAPI', aliases: ['fastapi'] },
  { label: 'SQL', aliases: ['sql', 'postgresql', 'postgres', 'mysql'] },
  { label: 'PostgreSQL', aliases: ['postgresql', 'postgres'] },
  { label: 'Docker', aliases: ['docker'] },
  { label: 'Kubernetes', aliases: ['kubernetes', 'k8s'] },
  { label: 'Terraform', aliases: ['terraform'] },
  { label: 'CI/CD', aliases: ['ci/cd', 'cicd'] },
  { label: 'Linux', aliases: ['linux'] },
  { label: 'Git', aliases: ['git'] },
  { label: 'Figma', aliases: ['figma'] },
  { label: 'Python/Аналитика', aliases: ['pandas', 'numpy'] },
  { label: 'SQL-аналитика', aliases: ['databases', 'базы данных'] },
  { label: 'Продуктовые метрики', aliases: ['метрик', 'metrics', 'metric'] },
  { label: 'Исследования', aliases: ['исследовани', 'research'] },
  { label: 'Исследования пользователей', aliases: ['интервью', 'юзабилити'] },
  { label: 'SAAS', aliases: ['saas', 'b2b'] },
  { label: 'Agile/Scrum', aliases: ['agile', 'scrum', 'kanban'] },
  { label: 'UI-дизайн', aliases: ['ui', 'prototype', 'прототип'] },
  { label: 'Performance-маркетинг', aliases: ['performance', 'таргет', 'контекст'] },
  { label: 'SEO', aliases: ['seo'] },
  { label: 'Команда разработки', aliases: ['команда', 'team lead'] },
];
