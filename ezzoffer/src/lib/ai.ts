import { logError } from './logger';

/**
 * Реальное ИИ-улучшение резюме/писем через OpenAI-совместимый API.
 * Настраивается env: AI_API_KEY, AI_BASE_URL, AI_MODEL.
 * Без ключа возвращается null — вызывающий код использует локальные эвристики.
 */

export type AiEnhanceResult = {
  content: string;
  notes: string[];
  tips: string[];
};

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim());
}

const DEFAULT_MODEL = 'gpt-4o-mini';

function baseUrl(): string {
  return (process.env.AI_BASE_URL?.trim() ?? 'https://api.openai.com/v1').replace(/\/$/, '');
}

async function chat(prompt: string, system: string): Promise<string | null> {
  const key = process.env.AI_API_KEY?.trim();
  if (!key) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${baseUrl()}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL?.trim() ?? DEFAULT_MODEL,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logError('ai', new Error(`HTTP ${res.status}`), { detail: detail.slice(0, 300) });
      return null;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (e) {
    logError('ai', e);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function enhanceResumeWithAi(content: string): Promise<AiEnhanceResult | null> {
  const system =
    'Ты — карьерный консультант и эксперт по ATS-резюме. Улучши резюме кандидата: ' +
    'усиль формулировки, добавь измеримые результаты, структурируй, соблюдай правила ATS-парсеров ' +
    '(без таблиц, без графиков, без лишних стилей). Отвечай строго в JSON.';
  const prompt = `Улучши следующее резюме. Верни JSON вида: {"content": "...", "notes": ["..."], "tips": ["..."]}.
Резюме:
"""${content}"""`;

  const raw = await chat(prompt, system);
  if (!raw) return null;
  try {
    const jsonText = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonText) as {
      content?: string;
      notes?: unknown;
      tips?: unknown;
    };
    const result: AiEnhanceResult = {
      content:
        typeof parsed.content === 'string' && parsed.content.trim()
          ? parsed.content.trim()
          : content,
      notes: Array.isArray(parsed.notes)
        ? parsed.notes.filter((n): n is string => typeof n === 'string').slice(0, 10)
        : [],
      tips: Array.isArray(parsed.tips)
        ? parsed.tips.filter((t): t is string => typeof t === 'string').slice(0, 10)
        : [],
    };
    if (!result.notes.length) result.notes = ['Резюме улучшено с помощью ИИ'];
    if (!result.tips.length) result.tips = ['Добавьте конкретные цифры в разделы опыта'];
    return result;
  } catch {
    return null;
  }
}

export async function writeCoverLetterWithAi(
  vacancy: { title: string; company: string; about?: string },
  resume: string,
): Promise<string | null> {
  const system =
    'Ты — опытный HR-специалист, помогающий соискателям. Напиши персонализированное сопроводительное письмо ' +
    'по вакансии. Пиши от первого лица, без канцелярита, 3–5 абзацев, с конкретными фактами из резюме. ' +
    'Верни только текст письма без кавычек и пометок.';
  const prompt = `Вакансия: ${vacancy.title} (${vacancy.company})
${vacancy.about ? `Описание: ${vacancy.about.slice(0, 2000)}` : ''}

Резюме соискателя:
"""${resume.slice(0, 4000)}"""

Напиши сопроводительное письмо.`;

  return chat(prompt, system);
}
