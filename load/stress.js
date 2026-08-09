// Stress test: find the breaking point. Starts at the SLO thresholds and lets
// you watch where error rate and p95 latency cross them as VUs ramp up. The
// pass/fail gates here are deliberately looser than load.js — this scenario is
// about capacity, not SLO conformance.
//   k6 run load/stress.js
import { check, sleep } from 'k6';
import { login, readRequest } from './common.js';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },
        { duration: '2m', target: 50 },
        { duration: '2m', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
  },
};

export function setup() {
  return { token: login() };
}

export default function (data) {
  const res = readRequest(data.token);
  check(res, { 'read request is 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(0.5);
}
