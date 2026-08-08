/** Supported proxy protocols. `socks5h` is accepted as input and normalized to
 *  `socks5` for storage/selection. */
export const PROXY_TYPES = ['http', 'socks5'] as const;
export type ProxyType = (typeof PROXY_TYPES)[number];

export interface ProxyInstance {
  id: string;
  /** Full URL, may include `user:password@` — never log it, never return it raw. */
  url: string;
  type: ProxyType;
  /** Higher priority proxies are preferred for selection. */
  priority: number;
  enabled: boolean;
  /** 0-100; decays on failure, recovers on success. Zero excludes the proxy. */
  healthScore: number;
  lastFailedAt?: string;
  requestsCount: number;
  failureCount: number;
}
