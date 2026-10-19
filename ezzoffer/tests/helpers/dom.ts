/**
 * Окружение для рендера React-компонентов в тестах.
 *
 * Отдельный файл, потому что глобальные переменные (window, document,
 * HTMLElement…) обязаны существовать ДО импорта react-dom: иначе он
 * поднимется, решит, что «среды нет», и отдаст серверную сборку, где
 * нет ни createPortal, ни эффектов, ни фокуса.
 *
 * Это те самые эффекты, ради которых существуют тесты диалогов:
 * фокус, ловушка и возврат фокуса живут в useEffect.
 */
import { JSDOM } from 'jsdom';

export interface DomHandle {
  window: Window & typeof globalThis;
  document: Document;
  container: HTMLElement;
  cleanup: () => void;
}

/**
 * Поднимает DOM и прокидывает глобалы. Возвращает контейнер, который
 * нужно отрендерить в act().
 */
export function setupDom(html = '<!doctype html><html><body></body></html>'): DomHandle {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' });
  const win = dom.window as unknown as Window & typeof globalThis;

  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    HTMLInputElement: win.HTMLInputElement,
    Element: win.Element,
    Node: win.Node,
    Event: win.Event,
    KeyboardEvent: win.KeyboardEvent,
    MouseEvent: win.MouseEvent,
    getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    IS_REACT_ACT_ENVIRONMENT: true,
  };

  const saved: Record<string, unknown> = {};
  const target = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(globals)) {
    saved[key] = target[key];
    // defineProperty, а не присваивание: часть глобалов (например navigator)
    // в Node определена геттером без сеттера, и присваивание бросает.
    Object.defineProperty(target, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }

  const container = win.document.createElement('div');
  win.document.body.appendChild(container);

  return {
    window: win,
    document: win.document,
    container,
    cleanup: () => {
      dom.window.close();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete (globalThis as Record<string, unknown>)[key];
        else (globalThis as Record<string, unknown>)[key] = value;
      }
    },
  };
}

/** Нажимает клавишу на документе — так же, как это делает реальный браузер. */
export function pressKey(doc: Document, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const win = doc.defaultView!;
  const event = new win.KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  doc.dispatchEvent(event);
  return event;
}
