'use client';

import { useState, type FormEvent } from 'react';
import { ScoreBadge } from './score-badge';
import {
  Badge,
  EmptyState,
  Field,
  btnPrimary,
  btnGhost,
  btnDanger,
  inputCls,
  StatusMessage,
} from '@/components/dashboard/ui';
import { Dialog, ConfirmDialog } from '@/components/dialog';
import { RESUME_TEMPLATES } from '@/lib/data';
import { HhImportButton } from './hh-import';
import { ResumeMatchPanel } from './resume-match-panel';
import { VariantPanel } from './variant-panel';
import { FileDown, Sparkles } from 'lucide-react';

type Resume = {
  id: number;
  title: string;
  content: string;
  years_label: string;
  ai_improved: number;
  /** id резюме на hh; null — резюме создано вручную и отправлено не будет. */
  hh_id: string | null;
  updated_at: number;
};

type Draft = { id: number | null; title: string; years_label: string; content: string };

const emptyDraft: Draft = { id: null, title: '', years_label: '', content: '' };

export function ResumesManager({ initial }: { initial: Resume[] }) {
  const [resumes, setResumes] = useState<Resume[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [improvingId, setImprovingId] = useState<number | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  /** id резюме, у которого раскрыта сверка с вакансией; null — всё закрыто. */
  const [openMatch, setOpenMatch] = useState<number | null>(null);
  /** id резюме, удаление которого сейчас подтверждается; null — окно закрыто. */
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [improveResult, setImproveResult] = useState<{
    resume: Resume;
    notes: string[];
    tips: string[];
    keywords: string[];
    score: { before: number; after: number };
  } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(draft.id ? `/api/resumes/${draft.id}` : '/api/resumes', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось сохранить резюме');
        return;
      }
      const saved = data.resume as Resume;
      setResumes((prev) =>
        draft.id ? prev.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...prev],
      );
      setDraft(null);
    } catch {
      setError('Сеть недоступна — изменения не сохранены');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    // Без этой защиты двойной клик отправлял второй DELETE уже удалённой
    // записи, и пользователь ловил ложную ошибку.
    if (removingId !== null) return;
    setRemovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/resumes/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Не удалось удалить резюме');
        return;
      }
      setResumes((prev) => prev.filter((r) => r.id !== id));
      setConfirmId(null);
    } catch {
      setError('Сеть недоступна — резюме не удалено');
    } finally {
      setRemovingId(null);
    }
  };

  const improve = async (id: number) => {
    setImprovingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/resumes/${id}/improve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось улучшить резюме');
        return;
      }
      setResumes((prev) => prev.map((r) => (r.id === id ? (data.resume as Resume) : r)));
      setImproveResult(data);
    } catch {
      setError('Сеть недоступна — улучшение не применено');
    } finally {
      setImprovingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setDraft(emptyDraft);
            setImproveResult(null);
          }}
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none">
            <path
              d="M12 5v14M5 12h14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Создать резюме
        </button>
        {/*
          Шаблоны — раскрытие, а не всплывающее меню.

          Тут было три поломки, и все три — из-за выбранного приёма:

          1. ОТКРЫТИЕ ПО НАВЕДЕНИЮ. `group-hover:opacity-100` без
             `focus-within` делал меню недоступным с клавиатуры и неработающим
             на тачскрине, где наведения нет вовсе. Кнопка «Шаблоны» была
             мёртвой на телефоне.

          2. ПРИВЯЗКА К КНОПКЕ. `absolute left-0` значит «левый край панели
             совпадает с левым краем кнопки». Но тулбар переносится
             (`flex-wrap`), и на телефоне кнопка «Шаблоны» оказывается
             прижата к правому краю. Замер в Chromium на 360px: панель
             начиналась на 127px и заканчивалась на 455px при ширине окна
             360 — то есть уводила вбок весь документ. Сдвиг кнопки влево
             «чинил» это до следующей ширины экрана.

          3. РАЗНЫЕ ПРАВИЛА НА УЗКИХ И ШИРОКИХ ЭКРАНАХ.

          Теперь на телефоне панель обычным блоком во всю ширину тулбара —
          у неё нет края, за который можно уехать. На широком экране это
          прежнее всплывающее меню, прижатое к правому краю кнопки.

          Раскрытие нативное (<details>), поэтому работает без JavaScript.
        */}
        <details className="group w-full sm:relative sm:w-auto">
          <summary
            className={`${btnGhost} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
          >
            <Sparkles className="size-4" />
            Шаблоны
          </summary>
          <div className="mt-2 w-full rounded-sm border border-line bg-surface p-2 sm:absolute sm:right-0 sm:mt-2 sm:w-64 sm:shadow-[0_18px_40px_-20px_rgba(21,19,15,0.4)]">
            {RESUME_TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="w-full rounded-sm px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2"
                onClick={() => {
                  setDraft({ id: null, title: t.title, years_label: '', content: t.content });
                  setImproveResult(null);
                }}
              >
                {t.title}
              </button>
            ))}
          </div>
        </details>

        <HhImportButton
          onImported={(resume) => {
            /*
             * Замена по id, а не добавление в начало.
             *
             * Повторный импорт того же резюме с hh обновляет существующую
             * запись, а не создаёт вторую: так человек перезаливает одно и то же.
             * Если бы мы добавляли, в списке появились бы две одинаковые
             * карточки, и человек решил бы, что импорт создал дубль.
             */
            setResumes((prev) => {
              const at = prev.findIndex((r) => r.id === resume.id);
              if (at === -1) return [resume, ...prev];
              const next = [...prev];
              next[at] = resume;
              return next;
            });
            setError(null);
          }}
          onError={(text) => setError(text)}
        />
      </div>

      {/* Ошибки удаления/улучшения. Ошибки сохранения показываются внутри
          диалога — один error-стейд на обе формы иначе дублировал бы текст.
          Когда открыт диалог, здесь текст пустой: элемент остаётся в DOM,
          чтобы живая область существовала заранее, но не занимает место. */}
      <StatusMessage tone="error">{draft === null ? error : null}</StatusMessage>

      {improveResult ? (
        <div className=" space-y-4 rounded-sm border border-accent/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-serif leading-snug text-ink">Резюме улучшено с AI</h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted">ATS-скоринг</span>
              <span className="font-semibold text-muted line-through">
                {improveResult.score.before}
              </span>
              <span className="text-accent-2">→</span>
              <span className="text-lg font-bold text-success">{improveResult.score.after}</span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                Что сделано
              </p>
              <ul className="space-y-1.5 text-sm">
                {improveResult.notes.map((n) => (
                  <li key={n} className="flex gap-2">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-success" />
                    {n}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                Советы
              </p>
              <ul className="space-y-1.5 text-sm text-muted">
                {improveResult.tips.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-1 size-1.5 shrink-0 rounded-full bg-accent-2" />
                    {t}
                  </li>
                ))}
              </ul>
              {improveResult.keywords.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {improveResult.keywords.map((k) => (
                    <Badge key={k} tone="cyan">
                      {k}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {resumes.length === 0 ? (
        <EmptyState
          title="Пока нет резюме"
          text="Создайте первое резюме — AI подскажет ключевые навыки и усилит его под вакансии."
        />
      ) : (
        <div className="space-y-3">
          {resumes.map((r) => (
            <div
              key={r.id}
              className=" flex flex-col gap-4 rounded-sm p-5 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-serif leading-snug text-ink">{r.title}</h2>
                  {r.ai_improved ? (
                    <Badge tone="success">Улучшено AI</Badge>
                  ) : (
                    <Badge>Черновик</Badge>
                  )}
                  {/*
                   * Привязка к hh определяет, какое резюме уйдёт в отклике.
                   * Без этой метки человек не видит разницы между резюме,
                   * которое участвует в подборе, и тем, которое реально
                   * отправляется — а это разные вещи, когда привязки нет.
                   */}
                  {r.hh_id ? (
                    <Badge tone="success">Отправляется на hh</Badge>
                  ) : (
                    <Badge tone="warn">Только для подбора</Badge>
                  )}
                  <ScoreBadge content={r.content} />
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-muted">
                  {r.content.split('\n').slice(0, 4).join(' · ')}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {r.years_label ? `${r.years_label} · ` : ''}
                  Обновлено {new Date(r.updated_at).toLocaleDateString('ru-RU')}
                </p>
                {openMatch === r.id ? (
                  <div className="mt-3">
                    <ResumeMatchPanel resumeId={r.id} />
                    <button
                      type="button"
                      className="-my-2 mt-2 inline-flex min-h-11 items-center text-xs text-muted underline"
                      onClick={() => setOpenMatch(null)}
                    >
                      Свернуть
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="-my-2 mt-2 inline-flex min-h-11 items-center text-xs text-muted underline"
                    onClick={() => setOpenMatch(r.id)}
                  >
                    Сверить с вакансией
                  </button>
                )}
                <VariantPanel resumeId={r.id} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={improvingId === r.id}
                  className={btnGhost}
                  onClick={() => improve(r.id)}
                >
                  <Sparkles className="size-4" />
                  {improvingId === r.id ? 'Усиляем…' : 'Улучшить с AI'}
                </button>
                <a href={`/api/resumes/export?resumeId=${r.id}`} className={btnGhost}>
                  <FileDown className="size-4" />
                  PDF
                </a>
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    setDraft({
                      id: r.id,
                      title: r.title,
                      years_label: r.years_label,
                      content: r.content,
                    });
                    setImproveResult(null);
                  }}
                >
                  Редактировать
                </button>
                <button type="button" className={btnDanger} onClick={() => setConfirmId(r.id)}>
                  Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Редактировать резюме' : 'Новое резюме'}
      >
        {draft ? (
          <form onSubmit={save} className="space-y-4">
            <Field label="Название">
              <input
                required
                maxLength={100}
                className={`${inputCls} w-full`}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Например: Frontend-разработчик, 3 года"
              />
            </Field>
            <Field label="Опыт (кратко)">
              <input
                maxLength={60}
                className={`${inputCls} w-full`}
                value={draft.years_label}
                onChange={(e) => setDraft({ ...draft, years_label: e.target.value })}
                placeholder="Например: 3 года · Middle"
              />
            </Field>
            <Field label="Текст резюме">
              <textarea
                required
                maxLength={20000}
                rows={14}
                className={`${inputCls} w-full min-h-56 resize-y font-mono text-[13px] leading-relaxed`}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder={'Опыт работы:\n- ...\n\nОбразование:\n- ...'}
              />
            </Field>
            <div className="space-y-4">
              <StatusMessage tone="error">{error}</StatusMessage>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className={btnGhost} onClick={() => setDraft(null)}>
                  Отмена
                </button>
                <button type="submit" disabled={saving} className={btnPrimary}>
                  {saving ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </div>
            </div>
          </form>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmId !== null}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => {
          if (confirmId !== null) void remove(confirmId);
        }}
        title="Удалить резюме?"
        description="Резюме и его история откликов будут удалены безвозвратно — восстановить их нельзя. Если хотите просто отключить, оставьте его в списке."
        busy={removingId !== null}
      />
    </div>
  );
}
