'use client';

import { useState, type FormEvent } from 'react';
import {
  Badge,
  EmptyState,
  Field,
  Panel,
  btnPrimary,
  inputCls,
  StatusMessage,
} from '@/components/dashboard/ui';

type Consultation = { id: number; theme: string; note: string; booked_at: number; done: number };

const THEMES = [
  'Разбор резюме',
  'Стратегия поиска работы',
  'Подготовка к собеседованию',
  'Анализ отказов и воронки',
  'Оценка оффера',
  'Другое',
];

const themeHint: Record<string, string> = {
  'Разбор резюме': 'Эксперт оценит ATS-скоринг, ключевые навыки и структуру, подскажет правки.',
  'Стратегия поиска работы':
    'Выстроим план: какие вакансии, отклики и сроки дадут результат за 3–4 недели.',
  'Подготовка к собеседованию': 'Потренируем ответы на вопросы и разберём типичные ловушки HR.',
  'Анализ отказов и воронки':
    'Посмотрим вашу статистику в кабинете и найдём точку роста конверсии.',
  'Оценка оффера': 'Сравним условия и поможем принять взвешенное решение.',
};

export function ConsultationsManager({ initial }: { initial: Consultation[] }) {
  const [items, setItems] = useState<Consultation[]>(initial);
  const [theme, setTheme] = useState(THEMES[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const book = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/consultations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Не удалось записаться');
        return;
      }
      setItems((prev) => [data.consultation, ...prev]);
      setNote('');
      setNotice('Заявка принята. Эксперт свяжется с вами в течение дня для выбора времени.');
    } catch {
      setError('Сеть недоступна — заявка не отправлена');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Panel className="lg:col-span-2">
        <h2 className="font-serif text-lg leading-snug text-ink">Записаться</h2>
        <form onSubmit={book} className="mt-5 space-y-4">
          <Field label="Тема">
            <select
              className={`${inputCls} w-full`}
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
            >
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          {themeHint[theme] ? (
            <p className="text-xs leading-relaxed text-muted">{themeHint[theme]}</p>
          ) : null}
          <Field label="Комментарий">
            <textarea
              rows={4}
              className={`${inputCls} w-full resize-y`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="О себе, ссылка на резюме, цель…"
            />
          </Field>
          <StatusMessage tone="error">{error}</StatusMessage>
          <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
            {busy ? 'Отправляем…' : 'Записаться на консультацию'}
          </button>
          <StatusMessage tone="success">{notice}</StatusMessage>
        </form>
      </Panel>

      <div className="space-y-3 lg:col-span-3">
        <p className="text-sm text-muted">
          {items.length ? `Заявок: ${items.length}` : 'Заявок пока нет'}
        </p>
        {items.length === 0 ? (
          <EmptyState
            title="Записей нет"
            text="Выберите тему слева и оставьте заявку — это бесплатно в рамках тарифов «Про» и «Эксперт»."
          />
        ) : (
          items.map((c) => (
            <div key={c.id} className=" flex flex-col gap-2 rounded-sm p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-serif leading-snug text-ink">{c.theme}</h3>
                <Badge tone={c.done ? 'success' : 'accent'}>
                  {c.done ? 'Проведена' : 'Ожидание'}
                </Badge>
              </div>
              {c.note ? <p className="text-sm text-muted">{c.note}</p> : null}
              <p className="text-xs text-muted">
                Заявка от{' '}
                {new Date(c.booked_at).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
