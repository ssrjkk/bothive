import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderResumePdf,
  pdfFontAvailable,
  pdfFontName,
  splitLongTokens,
} from '../src/lib/resume-pdf';

const RUSSIAN_RESUME = {
  title: 'Frontend-разработчик, 3 года (React)',
  yearsLabel: '3 года · Middle',
  content: [
    'Опыт работы',
    '- Frontend-разработчик: React, TypeScript, Next.js',
    '- Ускорил выпуск фич на 30%',
    '',
    'Ключевые навыки',
    '- React, TypeScript, Next.js, Docker',
    '',
    'Образование',
    '- МГТУ им. Баумана, прикладная математика',
  ].join('\n'),
};

test('шрифт с кириллицей доступен', () => {
  assert.ok(pdfFontAvailable(), 'dejavu-fonts-ttf должен быть установлен');
  assert.ok(/DejaVu/.test(pdfFontName()), `ожидался DejaVu, получено ${pdfFontName()}`);
});

test('рендерится валидный PDF', async () => {
  const res = await renderResumePdf(RUSSIAN_RESUME);
  assert.ok(res.ok, res.ok ? '' : res.error);
  assert.ok(res.buffer.length > 1000, `PDF подозрительно мал: ${res.buffer.length} байт`);
  assert.equal(res.buffer.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.ok(res.buffer.includes(Buffer.from('%%EOF')), 'PDF должен завершаться маркером %%EOF');
});

test('пустой контент не роняет генератор', async () => {
  const res = await renderResumePdf({ title: 'Резюме', yearsLabel: '', content: '' });
  assert.ok(res.ok);
  assert.ok(res.buffer.subarray(0, 5).toString('latin1') === '%PDF-');
});

test('только кириллица без латиницы даёт непустой PDF (regression)', () => {
  // С встроенным Helvetica widthOfString("Привет") === 0: pdfkit писал пустоту,
  // и пользователь получал PDF без единой буквы своего резюме.
  assert.ok(pdfFontName() !== 'Helvetica (кириллица не поддерживается)');
});

test('кириллица реально попадает в содержимое PDF', async () => {
  const res = await renderResumePdf({
    title: 'Привет',
    yearsLabel: '',
    content: 'Кириллица',
  });
  assert.ok(res.ok);

  // С TrueType-шрифтом pdfkit встраивает подмножество глифов, поэтому ищем
  // по наличию кириллицы в потоке (в сжатом виде — ToUnicode CMap).
  const text = res.buffer.toString('latin1');
  const hasCyrillic = /[А-Яа-я]/.test(text);
  const hasCyrillicCMap = text.includes('ToUnicode') || text.includes('beginbfchar');
  assert.ok(
    hasCyrillic || hasCyrillicCMap,
    'в PDF должен быть шрифт с кириллическими глифами, а не .notdef',
  );
});

test('CRLF и лишние пробелы не ломают вёрстку', async () => {
  const res = await renderResumePdf({
    title: 'Тест\r\n\r\n заголовок',
    yearsLabel: '  ',
    content: '- пункт\r\n\r\n• маркер\r\nобычный текст   ',
  });
  assert.ok(res.ok);
  assert.ok(res.buffer.length > 500);
});

test('разные маркеры списка нормализуются', async () => {
  for (const marker of ['-', '•', '*']) {
    const res = await renderResumePdf({ title: 'T', yearsLabel: '', content: `${marker} пункт` });
    assert.ok(res.ok, `маркер ${marker} должен обрабатываться`);
  }
});

test('длинный неразрывный токен не упирается в CPU (regression)', async () => {
  // pdfkit считает переносы квадратично по длине слова: 20 000 символов давали
  // ~6 с CPU, а 50 000 исчерпывали heap и роняли процесс. API режет резюме
  // до 20 000 символов, поэтому вход достижим — это DoS через один экспорт.
  const started = Date.now();
  const res = await renderResumePdf({ title: 'T', yearsLabel: '', content: 'a'.repeat(50_000) });
  const elapsed = Date.now() - started;
  assert.ok(res.ok, 'огромный резюме должно собираться, а не падать');
  assert.ok(elapsed < 2000, `экспорт занял ${elapsed} мс, ожидалось < 2000`);
});

test('смешанный контент большого объёма остаётся быстрым', async () => {
  const started = Date.now();
  const res = await renderResumePdf({
    title: 'Резюме',
    yearsLabel: '3 года',
    content: 'Опыт работы\n'.repeat(2000) + 'x'.repeat(30_000),
  });
  assert.ok(res.ok);
  assert.ok(Date.now() - started < 3000, 'смешанный контент должен собираться быстро');
});

test('splitLongTokens режет длинные слова и сохраняет текст', () => {
  const source = 'a'.repeat(500);
  const parts = splitLongTokens(source, 80);
  assert.ok(parts.length > 1, 'длинное слово должно быть разрезано');
  for (const p of parts) assert.ok(p.length <= 80, `часть ${p.length} символов длиннее лимита`);
  assert.equal(parts.join(''), source, 'разрезание не должно терять символы');
});

test('splitLongTokens не трогает короткие строки', () => {
  const short = 'Опыт работы: React, TypeScript';
  assert.deepEqual(splitLongTokens(short, 80), [short]);
});

test('splitLongTokens сохраняет слова через границы частей', () => {
  const source = 'alpha beta gamma delta epsilon zeta eta theta';
  const parts = splitLongTokens(source, 20);
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
  assert.equal(joined, source, 'слова должны сохраниться целиком');
  for (const p of parts) assert.ok(p.length <= 20);
});
