// Smoke test: 1 VU hits every major endpoint once per iteration to prove the
// stack is wired (login, health, all read routes) before load/stress runs.
//   k6 run load/smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL } from './config.js';
import { login, headers } from './common.js';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: { http_req_failed: ['rate<0.01'] },
};

export function setup() {
  return { token: login() };
}

export default function (data) {
  const h = headers(data.token);

  const health = http.get(`${BASE_URL}/health`);
  check(health, { '/health is 200': (r) => r.status === 200 });

  for (const path of [
    '/api/bots',
    '/api/accounts',
    '/api/stats',
    '/api/queues',
    '/api/scripts',
    '/api/logs',
  ]) {
    const r = http.get(`${BASE_URL}${path}`, { headers: h });
    check(r, { [`GET ${path} is 2xx`]: (x) => x.status >= 200 && x.status < 300 });
    sleep(0.2);
  }
}
