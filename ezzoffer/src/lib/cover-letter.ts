import { writeCoverLetterWithAi } from './ai';
import type { Vacancy } from './vacancies';

/**
 * Персонализация сопроводительного письма под конкретную вакансию.
 * Шаблонные переменные: {вакансия}, {компания}, {город}, {зарплата}, {формат}.
 * Если задан AI_API_KEY — генерируем письмо через LLM с фолбэком на шаблон.
 */

export type RenderedLetter = {
  content: string;
  engine: 'template' | 'ai';
};

export function renderLetterTemplate(template: string, vacancy: Vacancy): string {
  const salary = vacancy.salary || 'по договорённости';
  const map: Record<string, string> = {
    '{вакансия}': vacancy.title,
    '{компания}': vacancy.company,
    '{город}': vacancy.city || 'Россия',
    '{зарплата}': salary,
    '{формат}': vacancy.format || '—',
  };
  return template.replace(
    /\{вакансия\}|\{компания\}|\{город\}|\{зарплата\}|\{формат\}/g,
    (m) => map[m] ?? m,
  );
}

export async function personalizeLetter(
  template: string,
  vacancy: Vacancy,
  resumeContent: string,
): Promise<RenderedLetter> {
  // Сначала пробуем реальный LLM, если настроен.
  const ai = await writeCoverLetterWithAi(
    { title: vacancy.title, company: vacancy.company, about: vacancy.about },
    resumeContent,
  );
  if (ai && ai.trim().length > 20) {
    return { content: ai.trim(), engine: 'ai' };
  }
  return { content: renderLetterTemplate(template, vacancy), engine: 'template' };
}
