'use client';

import { useState } from 'react';
import { btnGhost } from '@/components/dashboard/ui';

/**
 * Проверка резюме по тексту вакансии.
 *
 * Показывает не «сколько процентов совпало», а две части: что в резюме уже
 * сказано теми же словами, что и в вакансии, и чего не сказано. Второе
 * названо ПРОБЕЛОМ и помечено как ожидание работодателя, а не как задание
 * дописать навык: подставлять то, чего у человека нет, нельзя, и такой
 * «пробел» дороже, чем честная пустая строка.
 *
 * Процент покрытия показан рядом с пояснением, что это входной фильтр,
 * а не обещание ответа. Без этой оговорки число читается как прогноз.
 */

type Item = { label: string; mentions: number; hint: string };
type Match = {
  matched: Item[];
  missing: Item[];
  coverage: number;
  notice: string;
};

export function ResumeMatchPanel({ resumeId }: { resumeId: number }) {
  const [vacancy, setVacancy] = useState('');
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/resumes/${resumeId}/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vacancy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? 'Не удалось проверить резюме');
        return;
      }
      setMatch(data.match as Match);
    } catch {
      setError('Не удалось проверить резюме: нет связи с сервером');
    } finally {
      setBusy(false);
    }
  };

  const percent = match ? Math.round(match.coverage * 100) : null;

  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="font-serif text-base leading-snug text-ink">Сверить с вакансией</h3>
      <p className="mt-1 text-sm text-muted">
        Вставьте текст вакансии — покажем, какие требования в резюме уже закрыты своими словами и
        каких не хватает.
      </p>

      <textarea
        value={vacancy}
        onChange={(e) => setVacancy(e.target.value)}
        rows={5}
        placeholder="Требуется React-разработчик. Обязанности: разработка на TypeScript, сборка через Docker…"
        className="mt-3 w-full rounded-sm border border-line bg-surface-2 p-3 text-sm text-ink"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || vacancy.trim().length === 0}
          className={btnGhost}
        >
          {busy ? 'Сверяем…' : 'Сверить'}
        </button>
        {percent !== null && (
          <span className="font-mono text-xs text-muted">Совпадение по словам: {percent}%</span>
        )}
      </div>

      <p role="alert" className={error ? 'mt-3 text-sm text-danger' : 'sr-only'}>
        {error ?? ''}
      </p>

      {match && (
        <div className="mt-4 space-y-4" data-resume-match={percent}>
          <p className="text-sm text-muted">{match.notice}</p>

          {match.matched.length > 0 && (
            <div>
              {/* Не h4: моноширинная метка в заголовке попадает в структуру
                  документа и становится пунктом оглавления. Это метка блока,
                  а не раздел, и начертание здесь как у eyebrow в SectionHead. */}
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-success">
                Уже есть в резюме
              </p>
              <ul className="mt-2 space-y-1">
                {match.matched.map((m) => (
                  <li key={m.label} className="text-sm text-ink">
                    {m.label}
                    {m.mentions > 1 && (
                      <span className="ml-2 font-mono text-xs text-muted">
                        ×{m.mentions} в вакансии
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {match.missing.length > 0 && (
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-warn">Пробелы</p>
              <p className="mt-1 text-xs text-muted">
                Это требования вакансии, которых в резюме нет. Если опыт есть — опишите его своими
                словами. Если нет — это честный пробел.
              </p>
              <ul className="mt-2 space-y-1">
                {match.missing.map((m) => (
                  <li key={m.label} className="text-sm text-ink">
                    {m.label}
                    {m.mentions > 1 && (
                      <span className="ml-2 font-mono text-xs text-muted">
                        ×{m.mentions} в вакансии
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
