import type { MetadataRoute } from 'next';

import { envBaseUrl } from '@/lib/env';

const base = envBaseUrl(process.env, 'SITE_URL', 'https://ezoffer.ru');

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Приватные зоны и служебные пути: краулеры не должны тратить лимит
      // на кабинет и на API, которые всё равно отдают 401/403.
      disallow: ['/dashboard', '/api/', '/login', '/signup'],
    },
    host: base,
    sitemap: `${base}/sitemap.xml`,
  };
}
