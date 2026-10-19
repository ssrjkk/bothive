import { jobs } from '../data';
import type { Vacancy, VacancyFetchResult, VacancyProvider, VacancyQuery } from './types';

function parseSalaryMin(text: string): number | null {
  const m = text.match(/от\s*([\d\s]+)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\s/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export function localVacancy(job: (typeof jobs)[number]): Vacancy {
  return {
    slug: job.slug,
    source: 'local',
    source_id: job.slug,
    title: job.title,
    company: job.company,
    salary: job.salary,
    salary_min: parseSalaryMin(job.salary),
    salary_max: null,
    level: job.level,
    format: job.format,
    city: job.city,
    posted: job.posted,
    published_at: null,
    category: job.category,
    about: job.about,
    responsibilities: job.responsibilities,
    requirements: job.requirements,
    bonus: job.bonus,
    source_url: null,
    contact_email: null,
    contact_phone: null,
  };
}

export function allLocalVacancies(): Vacancy[] {
  return jobs.map(localVacancy);
}

export const localProvider: VacancyProvider = {
  source: 'local',
  label: 'EZOffer',
  isAvailable: () => true,
  async fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult> {
    let list = allLocalVacancies();
    if (query.text) {
      const t = query.text.toLowerCase();
      list = list.filter((v) => `${v.title} ${v.company} ${v.category}`.toLowerCase().includes(t));
    }
    if (query.city) {
      const c = query.city.toLowerCase();
      list = list.filter((v) => v.city.toLowerCase().includes(c));
    }
    if (query.limit && query.limit > 0) list = list.slice(0, query.limit);
    return { vacancies: list, provider: 'local', ok: true };
  },
};
