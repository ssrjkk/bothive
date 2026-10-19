/**
 * Защита от SSRF для исходящих запросов.
 *
 * Адреса фидов и внешних источников приходят из env, но env тоже может быть
 * скомпрометирован (ошибка конфигурации, подстановка переменной из недоверенного
 * источника). Без проверки `file://`, `ftp://` и адресов внутренней сети сервер
 * стал бы читать локальные файлы и опрашивать служебные хосты.
 *
 * Проверяем:
 *  - схему (только http/https);
 *  - запрещённые диапазоны IP (loopback, private, link-local, CGNAT, IPv6-аналоги);
 *  - запрещённые имена хостов (localhost, *.local, метаданные облаков).
 *
 * Ограничение намеренно консервативное: проверяется литеральный адрес. Если
 * DNS-имя резолвится во внутренний IP (DNS rebinding), это не ловится здесь —
 * для полноценной защиты нужен сетевой уровень (allowlist egress), а не код.
 */

/** IPv4-подсети, которые не должны быть достижимы извне. */
const BLOCKED_IPV4: { cidr: string; base: number; bits: number }[] = [
  { cidr: '0.0.0.0/8', base: 0x00000000, bits: 8 },
  { cidr: '10.0.0.0/8', base: 0x0a000000, bits: 8 },
  { cidr: '100.64.0.0/10', base: 0x64400000, bits: 10 },
  { cidr: '127.0.0.0/8', base: 0x7f000000, bits: 8 },
  { cidr: '169.254.0.0/16', base: 0xa9fe0000, bits: 16 },
  { cidr: '172.16.0.0/12', base: 0xac100000, bits: 12 },
  { cidr: '192.0.0.0/24', base: 0xc0000000, bits: 24 },
  { cidr: '192.168.0.0/16', base: 0xc0a80000, bits: 16 },
  { cidr: '198.18.0.0/15', base: 0xc6120000, bits: 15 },
  { cidr: '224.0.0.0/4', base: 0xe0000000, bits: 4 },
  { cidr: '240.0.0.0/4', base: 0xf0000000, bits: 4 },
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
]);

function parseIpv4(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map((s) => Number(s));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return ((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0;
}

function isBlockedIpv4(ip: number): boolean {
  return BLOCKED_IPV4.some(({ base, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) >>> 0 === (base & mask) >>> 0;
  });
}

/**
 * Проверяет IPv6-адрес.
 *
 * Разбор сделан через нормализацию в 8 групп по 16 бит, а не префиксными
 * проверками строки: WHATWG-URL схлопывает IPv4-mapped адреса в hex-форму
 * («::ffff:127.0.0.1» превращается в «::ffff:7f00:1»), и проверка вида
 * /^f[cd]/ такой адрес не видела. Полное сравнение 128-битного значения
 * закрывает и fe80::/10, и fc00::/7, и mapped-диапазон одинаково.
 */

/**
 * Префиксы, которые ведут внутрь: unspecified, loopback, link-local,
 * unique-local. Хранятся четырьмя 32-битными словами (старшие → младшие).
 */
const BLOCKED_IPV6_PREFIXES: { words: number[]; bits: number }[] = [
  { words: [0, 0, 0, 0], bits: 128 }, // ::
  { words: [0, 0, 0, 1], bits: 128 }, // ::1
  { words: [0xfe800000, 0, 0, 0], bits: 10 }, // fe80::/10
  { words: [0xfc000000, 0, 0, 0], bits: 7 }, // fc00::/7
];

/** Маркер IPv4-mapped в битах 80..96 (0xffff). */
const IPV4_MAPPED_MARKER = 0x0000ffff;

/**
 * Разбирает IPv6 в четыре 32-битных слова (старшие → младшие) либо null.
 *
 * BigInt здесь невозможен: проект собирается с target ES2017, где литералы
 * вида 0x…n запрещены компилятором.
 */
function parseIpv6(host: string): number[] | null {
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  // zone-id (fe80::1%eth0) не влияет на маршрутизацию для наших целей.
  h = h.split('%')[0]!;
  if (!h.includes(':')) return null;

  // Embedded IPv4 в конце («::ffff:127.0.0.1»).
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4) {
    const ip = parseIpv4(v4[1]!);
    if (ip === null) return null;
    const high = ((ip >>> 16) & 0xffff).toString(16);
    const low = (ip & 0xffff).toString(16);
    h = `${h.slice(0, h.length - v4[1]!.length)}${high}:${low}`;
  }

  const parseSide = (s: string): number[] | null => {
    if (!s) return [];
    const out: number[] = [];
    for (const part of s.split(':').filter((p) => p !== '')) {
      const n = parseInt(part, 16);
      if (!Number.isInteger(n) || n < 0 || n > 0xffff) return null;
      out.push(n);
    }
    return out;
  };

  const hasDoubleColon = h.includes('::');
  const [leftPart, rightPart] = hasDoubleColon ? h.split('::') : [h, ''];
  const left = parseSide(leftPart);
  const right = rightPart ? parseSide(rightPart) : [];
  if (left === null || right === null) return null;

  let groups: number[];
  if (hasDoubleColon) {
    const fill = 8 - (left.length + right.length);
    if (fill < 0) return null;
    groups = [...left, ...new Array<number>(fill).fill(0), ...right];
  } else {
    groups = [...left, ...right];
  }
  if (groups.length !== 8) return null;

  // Склеиваем пары 16-битных групп в 32-битные слова.
  const word = (i: number): number => (((groups[i]! << 16) >>> 0) | groups[i + 1]!) >>> 0;
  return [word(0), word(2), word(4), word(6)];
}

/** Сравнивает адрес с префиксом по первым `bits` бит. */
function matchesPrefix(words: number[], prefix: number[], bits: number): boolean {
  let remaining = bits;
  for (let i = 0; i < 4; i++) {
    if (remaining <= 0) return true;
    const take = Math.min(32, remaining);
    // take===32 сдвигает на 0, что корректно; охраняем только take===0.
    const mask = take === 0 ? 0 : (0xffffffff << (32 - take)) >>> 0;
    if ((words[i]! & mask) >>> 0 !== (prefix[i]! & mask) >>> 0) return false;
    remaining -= take;
  }
  return true;
}

function isBlockedIpv6(host: string): boolean {
  const words = parseIpv6(host);
  if (words === null) return false;

  for (const prefix of BLOCKED_IPV6_PREFIXES) {
    if (matchesPrefix(words, prefix.words, prefix.bits)) return true;
  }

  // IPv4-mapped: ::ffff:a.b.c.d.
  //
  // Расклад 128 бит по 32-битным словам: [g0g1][g2g3][g4g5][g6g7].
  // Для ::ffff:127.0.0.1 группы = [0,0,0,0, 0,0xffff, 0x7f00,0x0001], то есть
  // слова = [0, 0, 0xffff, 0x7f000001]. Маркер 0xffff стоит в words[2]
  // (биты 64..96), а встроенный IPv4 — в words[3]. Проверка в words[1]
  // никогда не срабатывала, и mapped-адреса внутренней сети проходили.
  if (words[0] === 0 && words[1] === 0 && words[2] === IPV4_MAPPED_MARKER) {
    return isBlockedIpv4(words[3] >>> 0);
  }

  // NAT64 (64:ff9b::) и Teredo не разбираем — это редкий случай в конфигурации
  // фидов, а ложное срабатывание хуже пропуска.
  return false;
}

/**
 * Разрешён ли исходящий запрос по этому URL.
 * Возвращает null, если всё в порядке, либо причину отказа.
 */
export function assertOutboundUrlAllowed(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'некорректный URL';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `схема ${url.protocol} запрещена (нужна http или https)`;
  }

  const host = url.hostname.toLowerCase();
  if (!host) return 'пустой хост';
  if (BLOCKED_HOSTNAMES.has(host)) return `хост ${host} запрещён`;
  // Служебные домены внутренней сети и одноточечные имена.
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return `домен ${host} запрещён`;
  }
  // Без точки — одиночный label обычно означает внутреннее имя в поиске домена.
  if (!host.includes('.') && !host.includes(':')) {
    return `одноточечное имя ${host} запрещено`;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4 !== null && isBlockedIpv4(ipv4)) {
    return `адрес ${host} принадлежит внутренней сети`;
  }
  if (isBlockedIpv6(host)) {
    return `адрес ${host} принадлежит внутренней сети`;
  }

  return null;
}

/** true, если исходящий запрос по URL разрешён. */
export function isOutboundUrlAllowed(raw: string): boolean {
  return assertOutboundUrlAllowed(raw) === null;
}

/**
 * Фильтрует список URL, оставляя только разрешённые, и сообщает причину
 * отбрасывания — чтобы в логах было видно, что произошло, а не просто молчало.
 */
export function filterOutboundUrls(urls: string[]): { allowed: string[]; rejected: string[] } {
  const allowed: string[] = [];
  const rejected: string[] = [];
  for (const raw of urls) {
    const reason = assertOutboundUrlAllowed(raw);
    if (reason === null) allowed.push(raw);
    else rejected.push(`${raw} (${reason})`);
  }
  return { allowed, rejected };
}
