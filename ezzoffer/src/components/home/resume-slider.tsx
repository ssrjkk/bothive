'use client';

import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Section, SectionHead } from '@/components/ui';

function BeforeBlock() {
  return (
    <div className="rounded-sm border border-line bg-surface p-5 md:p-6">
      <p className="mb-4 inline-flex rounded-sm bg-danger/10 px-3 py-1 text-xs font-semibold text-danger ring-1 ring-danger/25">
        До — пропускает фильтры
      </p>
      <div className="space-y-4 text-left">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-sm bg-danger/10 text-danger">
            ИИ
          </span>
          <div className="flex-1">
            <p className="h-2.5 w-2/3 rounded bg-danger/25" />
            <p className="mt-2 h-2 w-full rounded bg-danger/15" />
            <p className="mt-2 h-2 w-5/6 rounded bg-danger/15" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-sm bg-danger/10 text-danger">
            РП
          </span>
          <div className="flex-1">
            <p className="h-2.5 w-1/2 rounded bg-danger/25" />
            <p className="mt-2 h-2 w-full rounded bg-danger/15" />
            <p className="mt-2 h-2 w-4/6 rounded bg-danger/15" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-sm bg-danger/10 text-danger">
            HR
          </span>
          <div className="flex-1">
            <p className="h-2.5 w-3/4 rounded bg-danger/25" />
            <p className="mt-2 h-2 w-full rounded bg-danger/15" />
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-xs text-danger">
        Общие фразы · нет цифр · не совпадает с вакансией
      </p>
    </div>
  );
}

function AfterBlock() {
  return (
    <div className="rounded-sm border border-success/30 bg-surface p-5 md:p-6">
      <p className="mb-4 inline-flex rounded-sm bg-success/10 px-3 py-1 text-xs font-semibold text-success ring-1 ring-success/30">
        После — проходит ATS-фильтры
      </p>
      <div className="space-y-4 text-left">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-sm bg-success/15 text-success">
            ИИ
          </span>
          <div className="flex-1">
            <p className="h-2.5 w-2/3 rounded bg-success/70" />
            <p className="mt-2 h-2 w-full rounded bg-success/40" />
            <p className="mt-2 h-2 w-5/6 rounded bg-success/40" />
            <p className="mt-2 h-2 w-3/5 rounded bg-success/40" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-sm bg-success/15 text-success">
            РП
          </span>
          <div className="flex-1">
            <p className="h-2.5 w-1/2 rounded bg-success/70" />
            <p className="mt-2 h-2 w-full rounded bg-success/40" />
            <p className="mt-2 h-2 w-4/6 rounded bg-success/40" />
            <p className="mt-2 h-2 w-3/4 rounded bg-success/40" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-sm bg-success/15 text-success">
            HR
          </span>
          <div className="flex-1">
            <p className="h-2.5 w-3/4 rounded bg-success/70" />
            <p className="mt-2 h-2 w-full rounded bg-success/40" />
            <p className="mt-2 h-2 w-2/3 rounded bg-success/40" />
          </div>
        </div>
      </div>
      <p className="mt-5 text-center text-xs text-success">
        Цифры, ключевые навыки · структура под ATS · в 4 раза больше приглашений
      </p>
    </div>
  );
}

export function ResumeSlider() {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);

  const handlePointer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(96, Math.max(4, x)));
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setPos((p) => Math.max(4, p - 6));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setPos((p) => Math.min(96, p + 6));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setPos(4);
    } else if (e.key === 'End') {
      e.preventDefault();
      setPos(96);
    }
  };

  return (
    <Section id="resume">
      <SectionHead
        eyebrow="Умное исправление резюме"
        title={
          <>
            Резюме, которое <span className="text-accent">читают и пропускают</span> фильтры
          </>
        }
        sub="AI выделит вас среди кандидатов: структура, ключевые навыки и цифры под требования ATS и конкретных вакансий"
      />

      <div
        ref={ref}
        onPointerDown={handlePointer}
        onPointerMove={(e) => e.buttons === 1 && handlePointer(e)}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        className="relative mx-auto max-w-3xl cursor-ew-resize overflow-hidden rounded-sm border border-line bg-surface-2 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        role="slider"
        aria-label="Сравнение резюме до и после"
        aria-valuenow={Math.round(pos)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="p-4 md:p-6">
          <AfterBlock />
        </div>

        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pos}%` }}>
          <div className="h-full p-4 md:p-6">
            <BeforeBlock />
          </div>
        </div>

        <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
          <div className="absolute inset-y-0 -left-px w-px bg-ink" />
          <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="grid size-11 place-items-center rounded-sm border-2 border-ink bg-surface text-ink">
              <svg viewBox="0 0 24 24" className="size-5" fill="none">
                <path
                  d="m9 7-5 5 5 5M15 7l5 5-5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute top-3 left-3 rounded-sm bg-surface-2 px-3 py-1 text-xs font-medium text-muted">
          До
        </div>
        <div className="pointer-events-none absolute top-3 right-3 rounded-sm bg-success/20 px-3 py-1 text-xs font-medium text-success">
          После
        </div>
      </div>

      <p className="mt-5 text-center text-sm text-muted">Потяните ползунок, чтобы сравнить</p>
    </Section>
  );
}
