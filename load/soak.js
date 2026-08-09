// Soak test: sustained moderate load for 30 minutes to catch slow leaks
// (memory growth, connection pool exhaustion, queue backlog creep) that a
// short load run misses. Inspect `bothive_worker_queue_depth`, Postgres
// connections and process RSS during the run via Grafana.
//   k6 run load/soak.js
import { check, sleep } from 'k6';
import { login, readRequest, thresholds } from './common.js';

export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: 20,
      duration: '30m',
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
