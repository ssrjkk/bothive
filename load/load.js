// Load test: ramps to 30 concurrent VUs and holds, exercising the same read
// mix the dashboard produces. The threshold block is the pass/fail gate — a
// run that trips it means we are violating the SLOs in docs/slo.md.
//   k6 run load/load.js
//   k6 run -e BASE_URL=https://staging.bothive.example load/load.js
import { check, sleep } from 'k6';
import { login, readRequest, thresholds } from './common.js';

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 10 },
        { duration: '2m', target: 30 },
        { duration: '2m', target: 30 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds,
};

export function setup() {
  return { token: login() };
}

export default function (data) {
  const res = readRequest(data.token);
  check(res, { 'read request is 2xx': (r) => r.status >= 200 && r.status < 300 });
  sleep(1);
}
