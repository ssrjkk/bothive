'use client';

import { useState, type FormEvent } from 'react';
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

type Letter = { id: number; title: string; content: string; updated_at: number };
type Draft = { id: number | null; title: string; content: string };

const emptyDraft: Draft = { id: null, title: '', content: '' };

export function LettersManager({ initial }: { initial: Letter[] }) {
  const [letters, setLetters] = useState<Letter[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  /** id письма, удаление которого сейчас подтверждается; null — окно закрыто. */
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(draft.id ? `/api/letters/${draft.id}` : '/api/letters', {
        method: draft.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, content: draft.content }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось сохранить письмо');
        return;
      }
      const saved = data.letter as Letter;
      setLetters((prev) =>
        draft.id ? prev.map((l) => (l.id === saved.id ? saved : l)) : [saved, ...prev],
      );
      setDraft(null);
    } catch {
      setError('Сеть недоступна — письмо не сохранено');
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
      const res = await fetch(`/api/letters/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Не удалось удалить письмо');
        return;
      }
      setLetters((prev) => prev.filter((l) => l.id !== id));
      setConfirmId(null);
    } catch {
      setError('Сеть недоступна — письмо не удалено');
    } finally {
      setRemovingId(null);
    }
  };

  const fillTemplate = () => {
    setDraft((d) =>
      d
        ? {
            ...d,
            content:
              'Здравствуйте!\n\nМеня заинтересовала вакансия {вакансия} в компании {компания}. Мой опыт полностью соответствует требованиям: {ключевые навыки}. В последней роли я {достижение с цифрой}.\n\nБуду рад обсудить детали на собеседовании. Резюме прикрепляю.\n\nС уважением, {имя}',
          }
        : d,
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <button
          type="button"
          className={btnPrimary}
          onClick={() => {
            setDraft(emptyDraft);
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
          Создать письмо
        </button>
      </div>

      {/* Ошибка удаления. Ошибки сохранения живут внутри диалога (ниже) —
          один error-стейд на обе формы иначе показывал бы то же сообщение дважды.
          Когда открыт диалог, здесь текст пустой: элемент остаётся в DOM,
          чтобы живая область существовала заранее, но не занимает место. */}
      <StatusMessage tone="error">{draft === null ? error : null}</StatusMessage>

      {letters.length === 0 ? (
        <EmptyState
          title="Писем пока нет"
          text="Создайте шаблон сопроводительного письма — AI подставит ключевые навыки и достижения в каждый отклик."
        />
      ) : (
        <div className="space-y-3">
          {letters.map((l) => (
            <div
              key={l.id}
              className=" flex flex-col gap-4 rounded-sm p-5 sm:flex-row sm:items-start"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-serif leading-snug text-ink">{l.title}</h2>
                  <Badge>{l.content.length} симв.</Badge>
                </div>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted">
                  {l.content}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className={btnGhost}
                  onClick={() => {
                    setDraft({ id: l.id, title: l.title, content: l.content });
                  }}
                >
                  Редактировать
                </button>
                <button
                  type="button"
                  className={btnDanger}
                  disabled={removingId !== null}
                  onClick={() => setConfirmId(l.id)}
                >
                  {removingId === l.id ? 'Удаляем…' : 'Удалить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Редактировать письмо' : 'Новое письмо'}
      >
        {draft ? (
          <form onSubmit={save} className="space-y-4">
            {!draft.id ? (
              <button type="button" onClick={fillTemplate} className={btnGhost}>
                Заполнить шаблон
              </button>
            ) : null}
            <Field label="Название">
              <input
                required
                maxLength={100}
                className={`${inputCls} w-full`}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Например: Стандартное письмо"
              />
            </Field>
            <Field label="Текст письма">
              <textarea
                required
                maxLength={20000}
                rows={9}
                className={`${inputCls} w-full min-h-44 resize-y leading-relaxed`}
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                placeholder="Здравствуйте!..."
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
        title="Удалить письмо?"
        description="Шаблон сопроводительного письма будет удалён безвозвратно. Его можно будет написать заново, но сохранённый текст вернуть не получится."
        busy={removingId !== null}
      />
    </div>
  );
}
