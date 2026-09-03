'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// ── Local Alertmanager webhook receiver ────────────────────────────────────
// Every page-severity alert is POSTed here and appended as one JSON line into
// the mounted capture file (/data/webhook-capture.jsonl → D:\bothive\data\).
//
// Endpoints:
//   POST /bothive-alerts   — Alertmanager payload (JSON)
//   GET  /healthz          — liveness probe (200 if server is up)
//   GET  /                 — same as /healthz
//
// To change the destination, point alertmanager.yml at a real endpoint
// (PagerDuty/Opsgenie/Slack) instead of this container.
// ────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.WEBHOOK_PORT || 9999);
const OUT = process.env.WEBHOOK_CAPTURE || '/data/webhook-capture.jsonl';
const MAX_BODY = 1024 * 1024; // 1 MiB — Alertmanager payloads are small

fs.mkdirSync(path.dirname(OUT), { recursive: true });

let captured = 0;

const server = http.createServer((req, res) => {
  // Health / liveness probe
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, captured }));
    return;
  }

  // Only accept POST to the alertmanager path
  if (req.method !== 'POST' || req.url !== '/bothive-alerts') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
    return;
  }

  let raw = '';
  let overflow = false;

  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > MAX_BODY) {
      overflow = true;
      req.destroy();
    }
  });

  req.on('end', () => {
    if (overflow) {
      console.error('rejected payload exceeding %d bytes', MAX_BODY);
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end('{"error":"payload too large"}');
      return;
    }

    const entry = {
      ts: new Date().toISOString(),
      url: req.url,
      body: raw,
    };

    try {
      fs.appendFileSync(OUT, JSON.stringify(entry) + '\n');
      captured++;
      console.log('captured alert #%d len=%d', captured, raw.length);
    } catch (e) {
      console.error('write failed: %s', e.message);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });

  req.on('error', (e) => {
    console.error('request error: %s', e.message);
  });
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
function shutdown(signal) {
  console.log('%s received, shutting down…', signal);
  server.close(() => {
    console.log('server closed');
    process.exit(0);
  });
  // Force-kill after 5s if close hangs
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log('webhook-receiver listening on :%d → %s', PORT, OUT);
});
