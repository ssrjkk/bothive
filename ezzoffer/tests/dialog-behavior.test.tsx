import test from 'node:test';
import assert from 'node:assert/strict';
import { dom, pressKey } from './helpers/dom-setup';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { useState } from 'react';
import { Dialog, ConfirmDialog, focusableWithin } from '../src/components/dialog';

/**
 * Поведение модальных окон — настоящие тесты, а не проверка исходника.
 *
 * До этого покрытие было регулярками по файлу: assert.match(src, /…/).
 * Это проверяет наличие текста в коде, а не поведение. Стоило переписать
 * функцию эквивалентно — тест ломался бы; сломать поведение, оставив
 * текст, — проходил бы. Ловушка фокуса, Escape и возврат фокуса вообще
 * были проверены только руками в браузере, то есть не защищены от
 * регрессии никак.
 *
 * Здесь рендерим компонент по-настоящему в jsdom и жмём клавиши.
 */

let root: Root;

/**
 * Рендерит элемент и выполняет эффекты.
 *
 * Контейнер пересоздаётся на каждый тест, а не очищается: createRoot
 * привязывается к конкретному узлу, и очистка body оторвала бы его.
 */
async function render(node: React.ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
}

test.beforeEach(() => {
  dom.document.body.innerHTML = '';
  dom.document.body.style.overflow = '';
  const container = dom.document.createElement('div');
  dom.document.body.appendChild(container);
  root = createRoot(container);

  // Кнопка-инициатор: фокус на ней до открытия окна.
  const opener = dom.document.createElement('button');
  opener.textContent = 'Открыть';
  dom.document.body.appendChild(opener);
  opener.focus();
});

test.after(() => {
  act(() => root.unmount());
  dom.cleanup();
});

test('диалог объявляет роль, имя и модальность', async () => {
  await render(
    <Dialog open onClose={() => {}} title="Редактировать резюме">
      <input aria-label="Название" />
    </Dialog>,
  );

  const panel = dom.document.querySelector('[role="dialog"]') as HTMLElement | null;
  assert.ok(panel, 'окно не появилось');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  assert.ok(panel.getAttribute('aria-labelledby'), 'нет связи с заголовком');

  const labelId = panel.getAttribute('aria-labelledby')!;
  assert.equal(dom.document.getElementById(labelId)?.textContent, 'Редактировать резюме');
});

test('фокус переносится внутрь окна при открытии', async () => {
  await render(
    <Dialog open onClose={() => {}} title="Тест">
      <input aria-label="Поле" />
    </Dialog>,
  );

  const panel = dom.document.querySelector('[role="dialog"]')!;
  assert.ok(
    panel.contains(dom.document.activeElement),
    'фокус остался снаружи окна — клавиатурный пользователь о нём не узнает',
  );
});

test('Tab зацикливается внутри окна и не уходит на подложку', async () => {
  await render(
    <Dialog open onClose={() => {}} title="Тест">
      <input aria-label="Первый" />
      <input aria-label="Второй" />
    </Dialog>,
  );

  const panel = dom.document.querySelector<HTMLElement>('[role="dialog"]')!;
  const items = focusableWithin(panel);
  assert.ok(items.length >= 3, `ожидали крестик и два поля, получили ${items.length}`);

  const last = items[items.length - 1]!;
  const first = items[0]!;

  // Сфокусированы на последнем, жмём Tab — фокус должен перекинуться на первый.
  last.focus();
  act(() => {
    pressKey(dom.document, 'Tab');
  });
  assert.equal(
    dom.document.activeElement,
    first,
    'Tab с последнего элемента не вернулся к первому — фокус ушёл бы наружу',
  );

  // Обратный порядок: с первого по Shift+Tab — на последний.
  first.focus();
  act(() => {
    pressKey(dom.document, 'Tab', { shiftKey: true });
  });
  assert.equal(dom.document.activeElement, last, 'Shift+Tab с первого не дошёл до последнего');
});

test('Escape закрывает окно', async () => {
  let closed = 0;
  await render(
    <Dialog
      open
      onClose={() => {
        closed += 1;
      }}
      title="Тест"
    >
      <input aria-label="Поле" />
    </Dialog>,
  );

  act(() => {
    pressKey(dom.document, 'Escape');
  });
  assert.equal(closed, 1, 'Escape не вызвал закрытие');
});

test('закрытое окно возвращает фокус на кнопку, которая его открыла', async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Открыть окно
        </button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Тест">
          <input aria-label="Поле" />
        </Dialog>
      </>
    );
  }

  await render(<Harness />);
  const opener = dom.document.querySelector('button') as HTMLElement;
  opener.focus();

  act(() => {
    opener.click();
  });
  assert.ok(dom.document.querySelector('[role="dialog"]'), 'окно не открылось');

  act(() => {
    pressKey(dom.document, 'Escape');
  });
  assert.equal(dom.document.querySelector('[role="dialog"]'), null, 'окно не закрылось');
  assert.equal(
    dom.document.activeElement,
    opener,
    'фокус не вернулся на инициатора — следующий Tab начался бы с начала страницы',
  );
});

test('пока окно открыто, фон не скроллится', async () => {
  await render(
    <Dialog open onClose={() => {}} title="Тест">
      <input aria-label="Поле" />
    </Dialog>,
  );
  assert.equal(dom.document.body.style.overflow, 'hidden');

  act(() => {
    pressKey(dom.document, 'Escape');
  });
});

test('подтверждение использует alertdialog и ставит фокус на отмену', async () => {
  await render(
    <ConfirmDialog
      open
      onCancel={() => {}}
      onConfirm={() => {}}
      title="Удалить резюме?"
      description="Восстановить нельзя."
    />,
  );

  const panel = dom.document.querySelector('[role="alertdialog"]') as HTMLElement | null;
  assert.ok(panel, 'нет alertdialog');

  const focused = dom.document.activeElement as HTMLElement;
  assert.equal(
    focused.textContent?.trim(),
    'Отмена',
    'фокус не на отмене: Enter удалил бы то, что пользователь не выбирал',
  );
});

test('Escape в подтверждении отменяет, а не подтверждает', async () => {
  let confirmed = 0;
  let cancelled = 0;
  await render(
    <ConfirmDialog
      open
      onCancel={() => {
        cancelled += 1;
      }}
      onConfirm={() => {
        confirmed += 1;
      }}
      title="Удалить?"
      description="Безвозвратно."
    />,
  );

  act(() => {
    pressKey(dom.document, 'Escape');
  });
  assert.equal(cancelled, 1, 'Escape не отменил');
  assert.equal(confirmed, 0, 'Escape привёл к подтверждению удаления');
});

test('скрытые элементы не попадают в ловушку фокуса', async () => {
  const root2 = dom.document.createElement('div');
  root2.innerHTML = `
    <button id="visible">Видимая</button>
    <button id="hidden-el" hidden>Скрытая атрибутом</button>
    <button id="aria-hidden" aria-hidden="true">Скрытая для AT</button>
    <button id="disabled" disabled>Отключённая</button>
  `;
  dom.document.body.appendChild(root2);

  const ids = focusableWithin(root2).map((el) => el.id);
  assert.deepEqual(ids, ['visible'], `в ловушку попали скрытые: ${ids.join(', ')}`);

  root2.remove();
});

test('при закрытии прокрутка страницы возвращается как была', async () => {
  dom.document.body.style.overflow = 'auto';

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <Dialog open={open} onClose={() => setOpen(false)} title="Тест">
        <input aria-label="Поле" />
      </Dialog>
    );
  }

  await render(<Harness />);
  assert.equal(dom.document.body.style.overflow, 'hidden');

  act(() => {
    pressKey(dom.document, 'Escape');
  });
  // Без восстановления прежнего значения страница осталась бы заблокированной.
  assert.notEqual(dom.document.body.style.overflow, 'hidden');
});
