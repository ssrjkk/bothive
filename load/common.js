// Shared helpers for the k6 scenarios. Kept in plain JS so `k6 run` can load
// them directly (k6 imports are ECMAScript modules, no TS transpilation).
import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, EMAIL, PASSWORD } from './config.js';

/** Logs in once and returns the JWT used as `Authorization: Bearer <token>`. */
export function login() {
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'login returned 200': (r) => r.status === 200 });
  const body = res.json();
  return body?.data?.token ?? '';
}

export function headers(token) {
  return { Authorization: `Bearer ${token}` };
}

const READ_ENDPOINTS = ['/api/bots', '/api/accounts', '/api/stats', '/api/queues', '/api/scripts'];

/** A single "virtual user" unit of read traffic against the authenticated API. */
export function readRequest(token) {
  const path = READ_ENDPOINTS[Math.floor(Math.random() * READ_ENDPOINTS.length)];
  return http.get(`${BASE_URL}${path}`, { headers: headers(token) });
}

// Thresholds mirror the availability/latency SLIs from docs/slo.md: >= 99%
// requests succeed and p95 latency stays under 300ms for the whole run.
export const thresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<300'],
};
