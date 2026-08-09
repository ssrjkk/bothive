// Shared k6 config. Override via -e flags, e.g.:
//   k6 run -e BASE_URL=http://localhost:3000 -e LOAD_USER_EMAIL=admin@example.com load/load.js
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const EMAIL = __ENV.LOAD_USER_EMAIL || 'admin@example.com';
export const PASSWORD = __ENV.LOAD_USER_PASSWORD || 'admin';
