'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { Vacancy } from '@/lib/vacancies';
import {
  Badge,
  EmptyState,
  Field,
  Panel,
  btnPrimary,
  btnGhost,
  btnDanger,
  inputCls,
  StatusMessage,
} from '@/components/dashboard/ui';
import { ConfirmDialog } from '@/components/dialog';
import { Sparkles } from 'lucide-react';

type Resume = {
  id: number;
  title: string;
  content: string;
  years_label: string;
  ai_improved: number;
};
type Letter = { id: number; title: string; content: string };
type Search = {
  id: number;
  title: string;
  keywords: string;
  salary_min: number | null;
  salary_max: number | null;
  format: string;
  city: string;
  level: string;
  company_blacklist: string;
  active: number;
  started_at: number | null;
  created_at: number;
  match_count: number;
};
type Application = {
  id: number;
  job_slug: string;
  external_url?: string | null;
  withdrawable?: boolean;
};
type Source = { source: string; label: string; available: boolean; count: number };

import { SOURCE_LABELS } from '@/lib/source-labels';

const emptySearch = {
  title: '',
  keywords: '',
  level: '' as string,
  format: '' as string,
  city: '',
  salaryMin: '',
  salaryMax: '',
  blacklist: '',
};

function parseSalary(text: string): number {
  const m = text.match(/от\s*([\d\s]+)/);
  return m ? parseInt(m[1].replace(/\s/g, ''), 10) || 0 : 0;
}

const AUTOREFRESH_KEY = 'ez_jobs_autorefresh_at';
const AUTOREFRESH_MS = 10 * 60 * 1000;

export function JobExplorer() {
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [searches, setSearches] = useState<Search[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  /** Закладки: какие вакансии человек отложил «на потом». */
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [appliedId, setAppliedId] = useState(0);
  const [letterId, setLetterId] = useState(0);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('');
  const [format, setFormat] = useState('');
  const [minSalary, setMinSalary] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptySearch);
  const [creating, setCreating] = useState(false);
  /** id удаляемого поиска — защита от двойного клика и обратная связь. */
  const [removingId, setRemovingId] = useState<number | null>(null);
  /** id поиска, удаление которого подтверждается; null — окно закрыто. */
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const perPage = 20;
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [aiRecommendations, setAiRecommendations] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [externalUrl, setExternalUrl] = useState<Record<string, string>>({});
  const [markingExternal, setMarkingExternal] = useState('');
  const vacanciesRef = useRef<Vacancy[]>([]);

  useEffect(() => {
    vacanciesRef.current = vacancies;
  }, [vacancies]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const min = Number(minSalary) || 0;
    return vacancies.filter((v) => {
      if (query && !`${v.title} ${v.company} ${v.category}`.toLowerCase().includes(query))
        return false;
      if (level && v.level !== level) return false;
      if (format && v.format !== format) return false;
      const salary = v.salary_min ?? parseSalary(v.salary);
      if (min > 0 && salary > 0 && salary < min) return false;
      return true;
    });
  }, [vacancies, q, level, format, minSalary]);

  const totalPages = Math.ceil(filtered.length / perPage);
  const paginated = filtered.slice((page - 1) * perPage, page * perPage);

  const loadVacancies = useCallback(async (withRefresh: boolean) => {
    setRefreshing(withRefresh);
    try {
      const url = withRefresh ? '/api/jobs?refresh=1' : '/api/jobs';
      const res = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        if (withRefresh) setError(data.error ?? 'Не удалось обновить каталог');
        return;
      }
      if (Array.isArray(data.vacancies)) setVacancies(data.vacancies);
      if (Array.isArray(data.sources)) setSources(data.sources);
      if (withRefresh && data.refreshed) {
        setNotice(`Каталог обновлён: ${data.vacancies?.length ?? 0} вакансий`);
      }
    } catch {
      if (withRefresh) setError('Не удалось обновить каталог — попробуйте позже');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, l, s, a, jobs, ai, bm] = await Promise.all([
          fetch('/api/resumes').then((x) => x.json()),
          fetch('/api/letters').then((x) => x.json()),
          fetch('/api/searches').then((x) => x.json()),
          fetch('/api/applications').then((x) => x.json()),
          fetch('/api/jobs').then((x) => x.json()),
          fetch('/api/ai-recommendations').then((x) => x.json()),
          // Отдельный запрос, а не часть jobs: закладки живут в своей таблице,
          // и их отсутствие не должно ломать загрузку каталога.
          fetch('/api/bookmarks')
            .then((x) => x.json())
            .catch(() => ({ bookmarks: [] })),
        ]);
        if (!alive) return;
        setResumes(r.resumes ?? []);
        setLetters(l.letters ?? []);
        setSearches(s.searches ?? []);
        setApplied(new Set((a.applications as Application[]).map((x) => x.job_slug)));
        setSaved(new Set(((bm.bookmarks ?? []) as { slug: string }[]).map((x) => x.slug)));
        setAppliedId((r.resumes?.[0]?.id as number) ?? 0);
        setLetterId((l.letters?.[0]?.id as number) ?? 0);
        if (Array.isArray(jobs.vacancies)) setVacancies(jobs.vacancies);
        if (Array.isArray(jobs.sources)) setSources(jobs.sources);
        if (Array.isArray(ai.recommendations)) setAiRecommendations(ai.recommendations);
      } catch {
        if (alive) setError('Не удалось загрузить данные кабинета');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    const id = setInterval(() => {
      const hasExternal = vacanciesRef.current.some((v) => v.source !== 'local');
      if (hasExternal) return;
      const last = Number(window.localStorage.getItem(AUTOREFRESH_KEY) ?? 0);
      if (Date.now() - last >= AUTOREFRESH_MS) {
        window.localStorage.setItem(AUTOREFRESH_KEY, String(Date.now()));
        try {
          fetch('/api/jobs?refresh=1', { cache: 'no-store' })
            .then((x) => x.json())
            .then((data) => {
              if (Array.isArray(data.vacancies)) setVacancies(data.vacancies);
              if (Array.isArray(data.sources)) setSources(data.sources);
            })
            .catch(() => undefined);
        } catch {
          /* ignore */
        }
      }
    }, 60_000);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const apply = async (slug: string) => {
    setBusy(slug);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobSlug: slug,
          resumeId: appliedId || null,
          letterId: letterId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось отправить отклик');
        return;
      }
      setApplied((prev) => new Set(prev).add(slug));
      setNotice(
        `Отклик отправлен: ${data.application?.job?.title ?? slug} — статус ведётся в разделе «Отклики».`,
      );
    } finally {
      setBusy('');
    }
  };

  const markAsExternal = async (slug: string) => {
    setMarkingExternal(slug);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobSlug: slug, externalUrl: externalUrl[slug] || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось отметить отклик');
        return;
      }
      setApplied((prev) => new Set(prev).add(slug));
      setNotice(`Отклик отмечен: ${data.application?.job?.title ?? slug}`);
    } finally {
      setMarkingExternal('');
    }
  };

  const toggleSearch = async (id: number, active: boolean) => {
    setError(null);
    try {
      const res = await fetch(`/api/searches/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      if (!res.ok) {
        setError('Не удалось изменить состояние поиска');
        return;
      }
      const data = await res.json();
      setSearches((prev) => prev.map((s) => (s.id === id ? (data.search as Search) : s)));
    } catch {
      setError('Сеть недоступна — состояние поиска не изменено');
    }
  };

  const removeSearch = async (id: number) => {
    // Без этой защиты двойной клик отправлял второй DELETE уже удалённой
    // записи, и пользователь ловил ложную ошибку.
    if (removingId !== null) return;
    // Раньше здесь не было ни try/catch, ни обратной связи: при сетевом сбое
    // promise отклонялся, пользователь видел «ничего не произошло», а при
    // ошибке сервера `if (!res.ok) return` глотал её молча. Удаление поиска
    // останавливает автоотклики по нему, поэтому молчание здесь вводит в
    // заблуждение: человек считает, что отклики продолжатся.
    setError(null);
    setRemovingId(id);
    try {
      const res = await fetch(`/api/searches/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Не удалось удалить поиск');
        return;
      }
      setSearches((prev) => prev.filter((s) => s.id !== id));
      setConfirmId(null);
    } catch {
      setError('Сеть недоступна — поиск не удалён');
    } finally {
      setRemovingId(null);
    }
  };

  const createSearch = async (e: FormEvent, autoRun: boolean) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          keywords: draft.keywords,
          level: draft.level,
          format: draft.format,
          city: draft.city,
          salary_min: draft.salaryMin ? Number(draft.salaryMin) : null,
          salary_max: draft.salaryMax ? Number(draft.salaryMax) : null,
          company_blacklist: draft.blacklist,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось создать поиск');
        return;
      }
      let search = data.search as Search;
      if (autoRun) {
        const act = await fetch(`/api/searches/${search.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: true }),
        });
        const actData = await act.json();
        if (act.ok) search = actData.search as Search;
      }
      setSearches((prev) => [search, ...prev]);
      setDraft(emptySearch);
      setNotice(
        autoRun
          ? `Автопоиск «${search.title}» запущен — отклики начнут уходить.`
          : 'Поиск сохранён. Нажмите «Запустить», чтобы активировать.',
      );
    } catch {
      setError('Сеть недоступна — поиск не создан');
    } finally {
      setCreating(false);
    }
  };

  /**
   * Переключение закладки.
   *
   * Состояние переключается по ответу сервера, а не сразу по клику: иначе при
   * ошибке сети вакансия осталась бы помеченной в интерфейсе и не сохранилась
   * бы на самом деле — человек потом не нашёл бы её в избранном.
   */
  const toggleBookmark = async (slug: string) => {
    const wasSaved = saved.has(slug);
    try {
      const res = await fetch('/api/bookmarks', {
        method: wasSaved ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) {
        setError('Не удалось изменить избранное');
        return;
      }
      setSaved((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.delete(slug);
        else next.add(slug);
        return next;
      });
    } catch {
      setError('Сеть недоступна — закладка не сохранена');
    }
  };

  const levelOptions = ['Intern', 'Junior', 'Middle', 'Senior'];

  return (
    <div className="space-y-8">
      <StatusMessage tone="error">{error}</StatusMessage>
      <StatusMessage tone="success">{notice}</StatusMessage>

      <Panel>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-serif text-lg leading-snug text-ink">Автопоиск</h2>
          {searches.length ? (
            <Badge tone="accent">{searches.filter((s) => s.active).length} активных</Badge>
          ) : null}
        </div>

        {searches.length ? (
          <div className="mb-5 space-y-2.5">
            {searches.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-3 rounded-sm border border-line bg-surface-2 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{s.title}</span>
                    <Badge tone={s.active ? 'success' : 'neutral'}>
                      <span
                        className={`size-1.5 rounded-full ${s.active ? 'bg-success' : 'bg-muted'}`}
                      />
                      {s.active ? 'Работает' : 'Пауза'}
                    </Badge>
                    <Badge tone="cyan">подходит {s.match_count} вакансий</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {[
                      s.keywords && `ключи: ${s.keywords}`,
                      s.level,
                      s.format,
                      s.city,
                      s.salary_min && `от ${s.salary_min}`,
                      s.salary_max && `до ${s.salary_max}`,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Без фильтров'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className={s.active ? btnGhost : btnPrimary}
                    onClick={() => toggleSearch(s.id, !s.active)}
                  >
                    {s.active ? 'Пауза' : `Запустить · ${s.match_count}`}
                  </button>
                  <button type="button" className={btnDanger} onClick={() => setConfirmId(s.id)}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <form onSubmit={(e) => createSearch(e, true)} className="grid gap-4 md:grid-cols-2">
          <Field label="Название поиска">
            <input
              required
              maxLength={100}
              className={`${inputCls} w-full`}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Например: Frontend Middle"
            />
          </Field>
          <Field label="Ключевые слова (через запятую)">
            <input
              maxLength={400}
              className={`${inputCls} w-full`}
              value={draft.keywords}
              onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
              placeholder="react, typescript, next"
            />
          </Field>
          <Field label="Уровень">
            <select
              className={`${inputCls} w-full`}
              value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: e.target.value })}
            >
              <option value="">Любой</option>
              {levelOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Формат">
            <select
              className={`${inputCls} w-full`}
              value={draft.format}
              onChange={(e) => setDraft({ ...draft, format: e.target.value })}
            >
              <option value="">Любой</option>
              <option>Удалённо</option>
              <option>Гибрид</option>
              <option>В офисе</option>
            </select>
          </Field>
          <Field label="Город">
            <input
              maxLength={60}
              className={`${inputCls} w-full`}
              value={draft.city}
              onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              placeholder="Москва, Казань…"
            />
          </Field>
          <Field label="Зарплата, руб.">
            <div className="grid grid-cols-2 gap-2">
              <input
                className={`${inputCls} w-full`}
                type="number"
                value={draft.salaryMin}
                onChange={(e) => setDraft({ ...draft, salaryMin: e.target.value })}
                placeholder="от"
              />
              <input
                className={`${inputCls} w-full`}
                type="number"
                value={draft.salaryMax}
                onChange={(e) => setDraft({ ...draft, salaryMax: e.target.value })}
                placeholder="до"
              />
            </div>
          </Field>
          <div className="md:col-span-2">
            <Field label="Исключить компании (через запятую)">
              <input
                className={`${inputCls} w-full`}
                value={draft.blacklist}
                onChange={(e) => setDraft({ ...draft, blacklist: e.target.value })}
                placeholder="компания А, бренд Б"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <button type="submit" disabled={creating} className={btnPrimary}>
              {creating ? 'Создаём…' : 'Создать и запустить'}
            </button>
            <button
              type="button"
              disabled={creating}
              className={btnGhost}
              onClick={(e) => createSearch(e as unknown as FormEvent, false)}
            >
              Сохранить без запуска
            </button>
          </div>
        </form>
      </Panel>

      <Panel>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="font-serif text-lg leading-snug text-ink">Каталог вакансий</h2>
            <p className="mt-0.5 text-xs text-muted">
              {sources.map((src) => `${src.label} · ${src.count}`).join('  ')}
            </p>
            {sources.some((src) => src.source === 'hh' && !src.available) ? (
              <p className="mt-1 text-xs text-warn">
                Вакансии hh.ru отключены: задайте HH_ACCESS_TOKEN в окружении сервера.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              onClick={() => loadVacancies(true)}
              className={`${btnGhost} shrink-0`}
            >
              {refreshing ? 'Обновляем…' : 'Обновить вакансии'}
            </button>
            <input
              className={`${inputCls} w-full sm:w-44`}
              placeholder="Поиск…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {/* aria-label, а не только первый <option>: «Уровень» — это
                значение по умолчанию, а не имя элемента. Без имени скринридер
                озвучивал «выпадающий список, пункт 1 из 4» и молчал, что это. */}
            <select
              aria-label="Фильтр по уровню"
              className={`${inputCls} w-full sm:w-36`}
              value={level}
              onChange={(e) => setLevel(e.target.value)}
            >
              <option value="">Уровень</option>
              {levelOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select
              aria-label="Фильтр по формату работы"
              className={`${inputCls} w-full sm:w-36`}
              value={format}
              onChange={(e) => setFormat(e.target.value)}
            >
              <option value="">Формат</option>
              <option>Удалённо</option>
              <option>Гибрид</option>
              <option>В офисе</option>
            </select>
            <input
              className={`${inputCls} w-full sm:w-32`}
              type="number"
              placeholder="от ₽"
              value={minSalary}
              onChange={(e) => setMinSalary(e.target.value)}
            />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-line pb-4">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted">
            Откликаться от имени:
          </span>
          <select
            aria-label="Резюме для отклика"
            className={`${inputCls} w-full sm:w-56`}
            value={appliedId}
            onChange={(e) => setAppliedId(Number(e.target.value))}
          >
            <option value={0}>Без резюме</option>
            {resumes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Сопроводительное письмо для отклика"
            className={`${inputCls} w-full sm:w-56`}
            value={letterId}
            onChange={(e) => setLetterId(Number(e.target.value))}
          >
            <option value={0}>Без письма</option>
            {letters.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </div>

        {aiRecommendations.length > 0 ? (
          <div className="mb-4 rounded-sm border border-accent/20 bg-accent/5 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="size-4 text-accent" />
              <span className="text-sm font-semibold text-ink">AI-рекомендации</span>
            </div>
            <ul className="space-y-1.5">
              {aiRecommendations.map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-muted">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-sm border border-line bg-surface p-5">
                <div className="h-4 w-3/4 rounded bg-surface-2" />
                <div className="mt-2 h-3 w-1/2 rounded bg-surface-2" />
                <div className="mt-4 h-6 w-1/3 rounded bg-surface-2" />
                <div className="mt-2 h-3 w-full rounded bg-surface-2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Ничего не найдено"
            text="Попробуйте смягчить фильтры или нажмите «Обновить вакансии»."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {paginated.map((v) => (
              <div
                key={v.slug}
                className="flex flex-col gap-3 rounded-sm border border-line bg-surface-2 p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  {/*
                    min-w-0 обязателен на текстовой колонке.

                    Без него flex-элемент не сжимается: его автоматический
                    минимум равен ширине самого длинного слова заголовка.
                    Заголовок вакансии с hh — это часто одна длинная строка
                    («Senior Software Engineer, Golang, Kafka»), а справа
                    стоит колонка `shrink-0` с бейджами, которая своего места
                    не уступает. На 360px бокс карточки 244 px, а заголовок плюс
                    бейджи давали ~484 px.

                    Тот же приём уже применён в bookmarks-list — здесь его
                    просто не было.
                  */}
                  <div className="min-w-0">
                    <h3 className="font-serif leading-snug break-words text-ink">{v.title}</h3>
                    <p className="mt-0.5 break-words text-sm text-muted">
                      {v.company} · {v.city}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={applied.has(v.slug) ? 'success' : 'neutral'}>
                      {applied.has(v.slug) ? 'Отклик отправлен' : v.level}
                    </Badge>
                    <Badge tone={v.source === 'local' ? 'neutral' : 'cyan'}>
                      {SOURCE_LABELS[v.source] ?? v.source}
                    </Badge>
                  </div>
                </div>
                <p className="text-lg font-semibold text-accent-2">{v.salary}</p>
                <p className="line-clamp-2 text-sm text-muted">{v.about}</p>
                <div className="mt-auto flex flex-wrap gap-1.5">
                  <Badge>{v.format}</Badge>
                  <Badge>{v.category}</Badge>
                </div>
                <div className="mt-1 flex flex-col gap-2">
                  {/*
                  Ряд действий переносится, а не жмётся.

                  Раньше здесь стояло `flex gap-2` с главной кнопкой на
                  `flex-1` и двумя `shrink-0` рядом. На 360px измерено: дети
                  раскладывались в 253 / 163 / 228 px при боксе карточки 244 px,
                  то есть ряд уезжал за правый край на ~420 px и уводил в
                  сторону всю страницу. `flex-1` здесь не помогает: он задаёт
                  `flex-basis: 0`, но автоматический минимум элемента равен
                  min-content подписи, а два `shrink-0` своего места не
                  уступают.

                  `flex-wrap` + `basis-full` у главной кнопки дают то, что
                  нужно на телефоне: широкая кнопка отклика и две второстепенные
                  под ней, а на широком экране всё остаётся в одну строку.
                */}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy === v.slug || applied.has(v.slug)}
                      onClick={() => apply(v.slug)}
                      className={
                        applied.has(v.slug)
                          ? `${btnGhost} w-full basis-full disabled:opacity-60`
                          : `${btnPrimary} w-full basis-full`
                      }
                    >
                      {busy === v.slug
                        ? 'Отправляем…'
                        : applied.has(v.slug)
                          ? 'Уже откликнулись'
                          : 'Откликнуться сейчас'}
                    </button>
                    {v.source_url ? (
                      <a
                        href={v.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`${btnGhost} flex-1 sm:flex-none`}
                      >
                        На сайте
                      </a>
                    ) : null}
                    {/*
                     * Закладка доступна всегда, в том числе когда ссылка на
                     * площадку есть: именно в этом случае человек чаще всего
                     * и хочет сохранить вакансию — чтобы вернуться позже.
                     */}
                    <button
                      type="button"
                      onClick={() => toggleBookmark(v.slug)}
                      aria-pressed={saved.has(v.slug)}
                      className={`${btnGhost} flex-1 sm:flex-none`}
                    >
                      {saved.has(v.slug) ? 'В избранном' : 'В избранное'}
                    </button>
                  </div>
                  {!applied.has(v.slug) && v.source !== 'hh' ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        className={`${inputCls} w-full`}
                        placeholder="Ссылка на отклик (необязательно)"
                        value={externalUrl[v.slug] ?? ''}
                        onChange={(e) =>
                          setExternalUrl((prev) => ({ ...prev, [v.slug]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        disabled={markingExternal === v.slug}
                        onClick={() => markAsExternal(v.slug)}
                        className={`${btnGhost} shrink-0`}
                      >
                        {markingExternal === v.slug ? 'Отмечаем…' : 'Отметить отклик'}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
        {totalPages > 1 ? (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className={btnGhost}
            >
              Назад
            </button>
            <span className="text-sm text-muted">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className={btnGhost}
            >
              Вперёд
            </button>
          </div>
        ) : null}
      </Panel>

      <ConfirmDialog
        open={confirmId !== null}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId !== null) void removeSearch(confirmId);
        }}
        title="Удалить поиск?"
        description="Автоотклики по этому поиску остановятся, а накопленная статистика будет удалена вместе с ним. Восстановить поиск нельзя."
        busy={removingId !== null}
      />
    </div>
  );
}
