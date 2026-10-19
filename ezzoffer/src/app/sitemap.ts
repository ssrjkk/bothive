import type { MetadataRoute } from 'next';
import { jobs, articles, resumeExamples } from '@/lib/data';
import { envBaseUrl } from '@/lib/env';

// SITE_URL= (пусто, как в .env.example после копирования) не должен давать
// относительные URL: sitemap с url="/jobs" невалиден.
const base = envBaseUrl(process.env, 'SITE_URL', 'https://ezoffer.ru');

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // Все публичные страницы. Раньше /internships, /platform-rules и
  // /resume-examples отсутствовали, хотя они отдают 200 и индексируемы.
  const staticRoutes = [
    '',
    '/reviews',
    '/about',
    '/faq',
    '/jobs',
    '/pricing',
    '/blog',
    '/internships',
    '/platform-rules',
    '/resume-examples',
  ];
  const dynamic = [
    ...jobs.map((j) => `/jobs/${j.slug}`),
    ...articles.map((a) => `/blog/${a.slug}`),
    ...resumeExamples.map((r) => `/resume-examples/${r.slug}`),
  ];

  return [...staticRoutes, ...dynamic].map((route) => ({
    url: `${base}${route}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: route === '' ? 1 : 0.8,
  }));
}
