/**
 * Способы входа.
 *
 * Пароль — единственный способ, который был. Дальше понадобится GitHub,
 * Google, Яндекс, Telegram и вход по ссылке, и каждый из них по отдельности
 * тащит с собой свою кнопку, свой роут и свою проверку. Здесь они описаны
 * данными, поэтому добавление способа — это запись в реестре плюс, для
 * внешних, одна реализация интерфейса.
 *
 * Общий знаменатель всех способов — недоверенный ввод. Имя, почта и аватар,
 * которые прислал внешний сервис, попадают в профиль как есть: человек может
 * назваться «<script>» и подсунуть свой аватар вместо картинки. Поэтому
 * нормализация обязана быть ДО записи, а не на этапе отрисовки.
 */

export type AuthMethodId =
  'password' | 'link' | 'github' | 'google' | 'yandex' | 'telegram' | (string & {});

export type AuthMethod = {
  id: AuthMethodId;
  title: string;
  /** Пишет ли способ, что вход происходит без пароля. */
  passwordless: boolean;
  /**
   * Внешний провайдер: нужны client_id/secret из окружения. У внутренних
   * способов (пароль, ссылка) их нет.
   */
  env?: { id: string; secret: string };
  /** Авторизационная ссылка провайдера. */
  authorizeUrl?: string;
  /**
   * Умеет ли способ ЗАВЕРШИТЬ вход (обмен кода на личность).
   *
   * Кнопка без завершения — это враньё: человек уходит к провайдеру,
   * авторизуется там, возвращается — и получает 401 «провайдер не подтвердил
   * вход», потому что parseProviderResponse умеет разбирать только подпись
   * Telegram. Именно так GitHub/Google/Яндекс и «рекламировались, но были
   * сломаны»: ключи заданы, кнопка есть, входа нет.
   *
   * Поэтому незавершаемые способы не показываются (authMethodReady их гасит)
   * и ссылку не строят. Полноценный OAuth (обмен code→token→userinfo) для них
   * не написан намеренно: без живых ключей его нельзя проверить, а
   * непроверенный код входа хуже честной заглушки — он создаёт ложное чувство
   * «работает». Когда появятся ключи и возможность прогнать флоу живьём,
   * достаточно выставить completes: true и дописать разбор в oauth.ts.
   */
  completes?: boolean;
};

const methods: AuthMethod[] = [
  { id: 'password', title: 'Почта и пароль', passwordless: false, completes: true },
  { id: 'link', title: 'По ссылке из письма', passwordless: true, completes: false },
  {
    id: 'github',
    title: 'GitHub',
    passwordless: false,
    env: { id: 'GITHUB_CLIENT_ID', secret: 'GITHUB_CLIENT_SECRET' },
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    completes: false,
  },
  {
    id: 'google',
    title: 'Google',
    passwordless: false,
    env: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    completes: false,
  },
  {
    id: 'yandex',
    title: 'Яндекс',
    passwordless: false,
    env: { id: 'YANDEX_CLIENT_ID', secret: 'YANDEX_CLIENT_SECRET' },
    authorizeUrl: 'https://oauth.yandex.ru/authorize',
    completes: false,
  },
  {
    id: 'telegram',
    title: 'Telegram',
    passwordless: true,
    // Telegram Login подписывает значение, а не секрет приложения, поэтому
    // нужен только bot token.
    env: { id: 'TELEGRAM_BOT_TOKEN', secret: 'TELEGRAM_BOT_TOKEN' },
    authorizeUrl: 'https://oauth.telegram.org/auth',
    completes: true,
  },
];

export function authMethod(id: string): AuthMethod | undefined {
  return methods.find((m) => m.id === id);
}

export function authMethods(): AuthMethod[] {
  return methods;
}

/** Настроен ли способ: у внешнего есть ключи, у внутреннего — всегда. */
export function authMethodReady(id: string): boolean {
  const m = authMethod(id);
  if (!m) return false;
  // Способ без завершения входа не готов по определению: кнопка вела бы
  // человека к провайдеру и обратно — в 401. См. completes выше.
  if (m.completes === false) return false;
  if (!m.env) return true;
  return Boolean(process.env[m.env.id] && process.env[m.env.secret]);
}

/**
 * Нормализация данных, пришедших от внешнего сервиса.
 *
 * Обрезается по длине, выкидывается управление символами, и — главное —
 * email проверяется на форму. Провайдеры отдают то, что считают нужным, но
 * поле `email` у нас UNIQUE, и без проверки один человек с пустым или
 * мусорным адресом занял бы чужой логин.
 */
export type ExternalIdentity = {
  provider: AuthMethodId;
  providerId: string;
  email: string;
  name: string;
  avatarUrl?: string;
};

const MAX_EMAIL = 254;
const MAX_NAME = 100;

export function normalizeIdentity(raw: Partial<ExternalIdentity>): ExternalIdentity | null {
  const provider = String(raw.provider ?? '');
  const providerId = String(raw.providerId ?? '').slice(0, 64);
  if (!authMethod(provider) || !providerId) return null;

  const email = String(raw.email ?? '')
    .trim()
    .toLowerCase()
    // Управляющие символы в почте ломают и заголовки писем, и сравнение.
    .replace(/[\u0000-\u001f\u007f]/g, '');
  if (!email || email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) {
    // Без почты аккаунт не завести: восстановление пароля и письма без неё
    // не работают. Лучше явная ошибка, чем аккаунт без почты.
    return null;
  }

  const name = String(raw.name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME);

  return {
    provider,
    providerId,
    email,
    name,
    avatarUrl: raw.avatarUrl ? sanitizeAvatar(raw.avatarUrl) : undefined,
  };
}

/**
 * Аватар: только https и только известные картинки хоста.
 *
 * Прокси пропускает внешние URL (sanitizeExternalUrl), но аватар ставится в
 * `img src` на каждой странице, и чужой хост — это запрос браузера на
 * каждом показе. Список хостов узкий: провайдеры аватаров известны.
 */
const AVATAR_HOSTS = new Set([
  'avatars.githubusercontent.com',
  'github.com',
  'lh3.googleusercontent.com',
  'avatars.metahub.com',
  'yastatic.net',
  't.me',
]);

function sanitizeAvatar(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    if (!AVATAR_HOSTS.has(parsed.hostname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}
