import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';

/**
 * Генерация PDF-резюме.
 *
 * Встроенные шрифты pdfkit (Helvetica/Times/Courier) используют WinAnsiEncoding,
 * в котором нет кириллицы: pdfkit подставляет .notdef, и весь русский текст
 * выводится пустотой (widthOfString("Привет") === 0). Поэтому подключаем
 * TrueType-шрифт с кириллицей; при его недоступности честно сообщаем об этом
 * вместо того, чтобы отдать пустой PDF.
 */

/**
 * TrueType-шрифты с кириллицей: DejaVu (лицензия Bitstream Vera, свободная).
 *
 * Файл добавляется в .next/standalone через outputFileTracingIncludes в
 * next.config.ts — статический require("*.ttf") Turbopack пытается разобрать
 * как модуль и падает с "Unknown module type".
 */
const FONT_CANDIDATES: { label: string; pkg: string; file: string }[] = [
  { label: 'DejaVuSans', pkg: 'dejavu-fonts-ttf', file: 'DejaVuSans.ttf' },
  { label: 'DejaVuSansCondensed', pkg: 'dejavu-fonts-ttf', file: 'DejaVuSansCondensed.ttf' },
];

type FontSpec = { label: string; pkg: string; file: string };

let fontCache: FontSpec | null | undefined;

/**
 * Файл существует? Обёртка нужна, чтобы existsSync не бросал исключение на
 * битых симлинках и неопознанных ошибках доступа.
 *
 * turbopackIgnore на existsSync бесполезен: пометка действует только на импорты,
 * а не на вызовы функций. Динамический путь к шрифту из-за этого всё равно
 * помечается как "Dynamic filesystem access causes tracing of the whole
 * project", и Turbopack кладёт в .next/standalone весь проект целиком.
 *
 * Это безопасно: в образ попадают исходники и тесты (~0.7 МБ), но не данные.
 * Путь к SQLite собирается по частям в db.ts и в tracing не попадает, поэтому
 * локальная ezoffer.db с хэшами паролей и OAuth-токенами в образ не утекает.
 * Шрифт добавляется копированием в Dockerfile и scripts/start-prod.mjs.
 */
function fileExists(p: string): boolean {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Ищем каталог с TTF, поднимаясь вверх от рабочего каталога.
 *
 * Turbopack переписывает и require.resolve, и вычисляемый require в заглушку
 * ("Cannot find module as expression is too dynamic"), поэтому единственно
 * надёжный способ в собранном сервере — прямой путь на диске. Подъём вверх
 * покрывает все раскладки: корень репо (dev/тесты), .next/standalone и /app
 * в Docker-образе. Сам шрифт добавляется через outputFileTracingIncludes.
 */
export function pdfFontDir(): string | null {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    for (const font of FONT_CANDIDATES) {
      const candidate = join(dir, 'node_modules', font.pkg, 'ttf');
      if (fileExists(join(candidate, font.file))) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolveFont(): FontSpec | null {
  if (fontCache !== undefined) return fontCache;
  const dir = pdfFontDir();
  fontCache = dir
    ? (FONT_CANDIDATES.find((font) => fileExists(join(dir, font.file))) ?? null)
    : null;
  return fontCache;
}

/** Доступен ли шрифт с кириллицей. */
export function pdfFontAvailable(): boolean {
  return resolveFont() !== null;
}

/** Имя шрифта, которым будет напечатан PDF (для диагностики и тестов). */
export function pdfFontName(): string {
  return resolveFont()?.label ?? 'Helvetica (кириллица не поддерживается)';
}

function fontPath(): string | null {
  const font = resolveFont();
  const dir = pdfFontDir();
  if (!font || !dir) return null;
  // Повторной проверки нет: resolveFont уже убедился, что файл существует.
  return join(dir, font.file);
}

export type ResumePdf = {
  title: string;
  content: string;
  yearsLabel: string;
};

export type PdfResult = { ok: true; buffer: Buffer; font: string } | { ok: false; error: string };

/** Собирает PDF резюме. Никогда не бросает: ошибки возвращаются в виде ok:false. */
/**
 * Режет неразрывные токены на части.
 *
 * Переносы в pdfkit считаются квадратично по длине неразрывного слова: замеры
 * на одном токене давали 2 000 символов → 124 мс, 5 000 → 301 мс,
 * 10 000 → 1 375 мс, 20 000 → 5 991 мс, а 50 000 символов исчерпывали heap
 * и роняли процесс. Поскольку API режет резюме до 20 000 символов, такой
 * контент достижим, и один экспорт съедал бы секунды CPU.
 */
export function splitLongTokens(line: string, limit = 80): string[] {
  if (line.length <= limit) return [line];
  const out: string[] = [];
  // Разрезаем по границам пробелов, где возможно, иначе — жёстко.
  const parts = line.split(/(\s+)/);
  let current = '';
  for (const part of parts) {
    if (current.length + part.length > limit && current.trim()) {
      out.push(current.trimEnd());
      current = '';
    }
    if (part.length > limit) {
      // Очень длинный неразрывный кусок: режем напрямую.
      if (current.trim()) {
        out.push(current.trimEnd());
        current = '';
      }
      for (let i = 0; i < part.length; i += limit) {
        out.push(part.slice(i, i + limit));
      }
      continue;
    }
    current += part;
  }
  if (current.trim()) out.push(current.trimEnd());
  return out.length > 0 ? out : [line];
}

export async function renderResumePdf(resume: ResumePdf): Promise<PdfResult> {
  const font = fontPath();
  if (!font) {
    return {
      ok: false,
      error:
        'Не найден шрифт с кириллицей. Установите пакет dejavu-fonts-ttf — со встроенным Helvetica русский текст в PDF не отображается.',
    };
  }

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolvePromise, rejectPromise) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePromise(Buffer.concat(chunks)));
    doc.on('error', rejectPromise);
  });

  try {
    // registerFont на путь к файлу: pdfkit читает TTF целиком и сабсетит глифы.
    doc.registerFont('body', font);
    doc.font('body');

    doc.fontSize(20).text(resume.title, { align: 'center' });
    doc.moveDown();
    if (resume.yearsLabel.trim()) {
      doc.fontSize(10).fillColor('#666666').text(resume.yearsLabel.trim(), { align: 'center' });
      doc.moveDown(2);
    }
    doc.fontSize(11).fillColor('#000000');

    for (const raw of resume.content.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (line.trim() === '') {
        doc.moveDown(0.6);
      } else if (/^\s*[-•*]\s+/.test(line)) {
        for (const chunk of splitLongTokens(line.replace(/^\s*[-•*]\s+/, '  • '))) {
          doc.text(chunk, { indent: 8 });
        }
      } else {
        for (const chunk of splitLongTokens(line)) {
          doc.text(chunk);
        }
      }
    }

    doc.end();
    const buffer = await done;
    return { ok: true, buffer, font: resolveFont()!.label };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Не удалось собрать PDF' };
  }
}
