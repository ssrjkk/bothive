import type { Level, WorkFormat } from '../data';

export type VacancySource =
  | 'local'
  | 'trudvsem'
  | 'hh'
  | 'remoteok'
  | 'greenhouse'
  | 'ashby'
  | 'company' // RSS-фиды компаний
  | 'x' // X / Twitter
  | 'tg' // Telegram-каналы компаний
  | 'geekjob'
  | 'jobicy'
  | 'weworkremotely'
  | 'rabota'
  | 'flru'
  | 'kwork';

export type Vacancy = {
  slug: string;
  source: VacancySource;
  source_id: string;
  title: string;
  company: string;
  salary: string;
  salary_min: number | null;
  salary_max: number | null;
  level: Level;
  format: WorkFormat;
  city: string;
  /** Текст «3 дн. назад» — для показа человеку. */
  posted: string;
  /**
   * Дата публикации в миллисекундах. null, если площадка её не отдала.
   *
   * Нужна отдельно от `posted`: текст нельзя сравнивать, а именно возраст
   * решает, стоит ли вообще откликаться. Вакансия недельной давности почти
   * наверняка закрыта, и отклик на неё — это потраченный слот дневного
   * лимита, а лимит у человека один.
   */
  published_at: number | null;
  /**
   * Занятость от площадки, если она её отдаёт.
   *
   * Не у всех источников поля есть, и для hh его проверить не удалось: поиск
   * требует токена приложения. Зато у GeekJob есть `jobFormat.parttime`, у
   * Работы России — `employment` и `schedule`. Там, где поле есть, режим
   * работы определяется по нему, а не разбирается из текста вакансии.
   */
  employment?: string;
  category: string;
  about: string;
  responsibilities: string[];
  requirements: string[];
  bonus: string[];
  source_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
};

export type VacancyQuery = {
  text?: string;
  city?: string;
  limit?: number;
};

export type VacancyFetchResult = {
  vacancies: Vacancy[];
  provider: VacancySource;
  ok: boolean;
  error?: string;
};

export type VacancyApplyResult = {
  ok: boolean;
  error?: string;
  /**
   * Причина неудачи — по ней автоотклик решает, включать ли backoff.
   *
   * Разделение существенно. Backoff нужен, чтобы не выглядеть ботом и не
   * ловить блокировку. Отказ по закрытой вакансии — это не «платформа вас
   * отталкивает», а «вакансии больше нет»: включать по ней паузу значит
   * позволить одной мёртвой записи замедлить все последующие отклики.
   */
  kind?: 'closed' | 'rate_limit' | 'auth' | 'token' | 'network' | 'other';
  /** Сколько площадка попросила подождать, мс. 0 — не просила. */
  retryAfterMs?: number;
};

export interface VacancyProvider {
  source: VacancySource;
  label: string;
  /** Можно ли обновить каталог этого источника. Для hh нужен токен приложения. */
  isAvailable(): boolean;
  /**
   * Можно ли отправить отклик от имени пользователя.
   *
   * Отдельный метод не избыточен: у hh поиск требует токена приложения, а
   * отправка — только пользовательского. Проверка одним `isAvailable()`
   * выключала автоотклик у всех, у кого сервис не настроен на поиск, хотя их
   * собственный токен hh работал.
   */
  canApply?(userToken: string | null, resumeId: string | null): boolean;
  fetchVacancies(query: VacancyQuery): Promise<VacancyFetchResult>;
  apply?(
    vacancy: Vacancy,
    ctx: { resumeId: string; message?: string; accessToken?: string },
  ): Promise<VacancyApplyResult>;
}
