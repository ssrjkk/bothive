'use client';

import { useState, type FormEvent } from 'react';
import { Field, Panel, btnPrimary, inputCls } from '@/components/dashboard/ui';

/*
 * Профиль.
 *
 * Кроме учётных данных здесь то, по чему сервис понимает, что искать:
 * зарплатные ожидания и предпочитаемый город.
 *
 * Раньше полей не было вообще, и это была не мелочь: без зарплатных
 * ожиданий фактор «Зарплата» в оценке вакансии всегда оставался нейтральным,
 * то есть подсказка «вакансия на 60к против ваших ожиданий 180к» физически
 * не могла появиться. Один из самых частых фильтров при поиске был недоступен.
 */
export function ProfileForm({
  name,
  email,
  salaryExpectation,
  cityPreference,
}: {
  name: string;
  email: string;
  salaryExpectation: number | null;
  cityPreference: string;
}) {
  const [draft, setDraft] = useState({
    name,
    email,
    password: '',
    currentPassword: '',
    salary: salaryExpectation ? String(salaryExpectation) : '',
    city: cityPreference,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          email: draft.email,
          password: draft.password || undefined,
          currentPassword: draft.email !== email ? draft.currentPassword || undefined : undefined,
          // Пустая строка означает «ожиданий не назвал», а не ноль: при нуле
          // любая вакансия считалась бы выше ожиданий.
          salaryExpectation: draft.salary.trim() === '' ? null : Number(draft.salary),
          cityPreference: draft.city.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? 'Не удалось сохранить' });
        return;
      }
      setDraft((d) => ({ ...d, password: '', currentPassword: '' }));
      setMessage({ ok: true, text: 'Данные обновлены.' });
    } catch {
      setMessage({ ok: false, text: 'Сеть недоступна — данные не сохранены' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <h2 className="font-serif text-lg leading-snug text-ink">Профиль</h2>

      <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label="Имя">
          <input
            required
            maxLength={60}
            autoComplete="name"
            className={`${inputCls} w-full`}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            required
            maxLength={100}
            autoComplete="email"
            className={`${inputCls} w-full`}
            value={draft.email}
            onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          />
        </Field>

        {/*
          Зарплатные ожидания — влияют на оценку вакансий и на подбор.
          Ввод числом без потери фокуса: пустое поле означает «не назвал».
        */}
        <Field
          label="Зарплатные ожидания, ₽ (необязательно)"
          hint="Вакансии ниже этого порога будут получать меньшую оценку"
        >
          <input
            type="number"
            min={0}
            step={10000}
            inputMode="numeric"
            className={`${inputCls} w-full`}
            value={draft.salary}
            onChange={(e) => setDraft({ ...draft, salary: e.target.value })}
            placeholder="180000"
          />
        </Field>
        <Field
          label="Предпочитаемый город (необязательно)"
          hint="Используется в новых поисках под ваш выбор"
        >
          <input
            maxLength={80}
            className={`${inputCls} w-full`}
            value={draft.city}
            onChange={(e) => setDraft({ ...draft, city: e.target.value })}
            placeholder="Москва"
          />
        </Field>

        <div className="md:col-span-2">
          <Field label="Новый пароль (оставьте пустым, если не меняете)">
            <input
              type="password"
              minLength={6}
              maxLength={100}
              autoComplete="new-password"
              className={`${inputCls} w-full`}
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.target.value })}
              placeholder="••••••••"
            />
          </Field>
        </div>
        {draft.email.trim().toLowerCase() !== email ? (
          <div className="md:col-span-2">
            <Field label="Текущий пароль (подтверждение смены email)">
              <input
                type="password"
                minLength={6}
                maxLength={100}
                autoComplete="current-password"
                className={`${inputCls} w-full`}
                value={draft.currentPassword}
                onChange={(e) => setDraft({ ...draft, currentPassword: e.target.value })}
                placeholder="••••••••"
              />
            </Field>
          </div>
        ) : null}

        {/* Ошибка и успех попадают в разные живые области: ошибка должна
            прервать голос скринридера (alert), а подтверждение — озвучиться
            вежливо, не перебивая. Без этого форма выглядит «нерабочей»:
            кнопка нажата, а экран молчит. */}
        <div
          role={message?.ok ? 'status' : 'alert'}
          aria-live={message?.ok ? 'polite' : 'assertive'}
          className="text-sm md:col-span-2"
        >
          {message ? (
            <p className={message.ok ? 'text-success' : 'text-danger'}>{message.text}</p>
          ) : null}
        </div>
        <div className="md:col-span-2">
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
        </div>
      </form>
    </Panel>
  );
}
