'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Alertmanager webhook receiver with real notifications ────────────────────
// Receives page-severity alerts from Alertmanager and forwards them to
// configured notification channels (Telegram, Slack, Discord, generic webhook).
// Also logs all alerts locally for debugging.
//
// Environment variables:
//   WEBHOOK_PORT          — HTTP port (default: 9999)
//   WEBHOOK_CAPTURE       — Local log file path (default: /data/webhook-capture.jsonl)
//   NOTIFY_TELEGRAM       — Telegram bot token (format: "bot_token:chat_id")
//   NOTIFY_SLACK          — Slack webhook URL
//   NOTIFY_DISCORD        — Discord webhook URL
//   NOTIFY_WEBHOOK        — Generic webhook URL (POST with Alertmanager payload)
//
// Endpoints:
//   POST /bothive-alerts   — Alertmanager payload (JSON)
//   GET  /healthz          — liveness probe (200 if server is up)
//   GET  /                 — same as /healthz
// ────────────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.WEBHOOK_PORT || 9999);
const OUT = process.env.WEBHOOK_CAPTURE || '/data/webhook-capture.jsonl';
const MAX_BODY = 1024 * 1024; // 1 MiB — Alertmanager payloads are small

const TELEGRAM = process.env.NOTIFY_TELEGRAM;
const SLACK = process.env.NOTIFY_SLACK;
const DISCORD = process.env.NOTIFY_DISCORD;
const GENERIC_WEBHOOK = process.env.NOTIFY_WEBHOOK;

fs.mkdirSync(path.dirname(OUT), { recursive: true });

let captured = 0;
let notified = 0;

function formatAlert(alert) {
  const status = alert.status || 'unknown';
  const name = alert.labels?.alertname || 'UnknownAlert';
  const severity = alert.labels?.severity || 'unknown';
  const summary = alert.annotations?.summary || alert.labels?.summary || '';
  const description = alert.annotations?.description || '';
  const startsAt = alert.startsAt ? new Date(alert.startsAt).toISOString() : 'unknown';
  const endsAt = alert.endsAt ? new Date(alert.endsAt).toISOString() : 'N/A';

  return {
    text: `[${status.toUpperCase()}] ${name} (${severity})\n${summary}\n${description}\nStarted: ${startsAt}\nEnded: ${endsAt}`.trim(),
    json: {
      status,
      name,
      severity,
      summary,
      description,
      startsAt,
      endsAt,
      labels: alert.labels,
      annotations: alert.annotations,
    },
  };
}

function sendTelegram(message) {
  if (!TELEGRAM) return Promise.resolve();
  const [token, chatId] = TELEGRAM.split(':');
  if (!token || !chatId) return Promise.resolve();

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });

  return new Promise((resolve) => {
    const req = https.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      },
    );
    req.on('error', (e) => console.error('Telegram notify failed: %s', e.message));
    req.write(data);
    req.end();
  });
}

function sendSlack(message) {
  if (!SLACK) return Promise.resolve();
  const data = JSON.stringify({ text: message });

  return new Promise((resolve) => {
    const req = https.request(
      SLACK,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      },
    );
    req.on('error', (e) => console.error('Slack notify failed: %s', e.message));
    req.write(data);
    req.end();
  });
}

function sendDiscord(message) {
  if (!DISCORD) return Promise.resolve();
  const data = JSON.stringify({ content: message });

  return new Promise((resolve) => {
    const req = https.request(
      DISCORD,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      },
    );
    req.on('error', (e) => console.error('Discord notify failed: %s', e.message));
    req.write(data);
    req.end();
  });
}

function sendGenericWebhook(payload) {
  if (!GENERIC_WEBHOOK) return Promise.resolve();
  const data = JSON.stringify(payload);

  return new Promise((resolve) => {
    const req = https.request(
      GENERIC_WEBHOOK,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      },
    );
    req.on('error', (e) => console.error('Webhook notify failed: %s', e.message));
    req.write(data);
    req.end();
  });
}

async function notify(payload) {
  const alerts = payload.alerts || [];
  if (alerts.length === 0) return;

  const messages = alerts.map(formatAlert);
  const combinedText = messages.map((m) => m.text).join('\n\n---\n\n');

  const promises = [];
  if (TELEGRAM) promises.push(sendTelegram(combinedText));
  if (SLACK) promises.push(sendSlack(combinedText));
  if (DISCORD) promises.push(sendDiscord(combinedText));
  if (GENERIC_WEBHOOK) promises.push(sendGenericWebhook(payload));

  await Promise.allSettled(promises);
  notified += alerts.length;
}

const server = http.createServer((req, res) => {
  // Health / liveness probe
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, captured, notified }));
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

  req.on('end', async () => {
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

    try {
      const payload = JSON.parse(raw);
      await notify(payload);
    } catch (e) {
      console.error('notify failed: %s', e.message);
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
  if (TELEGRAM) console.log('  Telegram notifications enabled');
  if (SLACK) console.log('  Slack notifications enabled');
  if (DISCORD) console.log('  Discord notifications enabled');
  if (GENERIC_WEBHOOK) console.log('  Generic webhook notifications enabled');
  if (!TELEGRAM && !SLACK && !DISCORD && !GENERIC_WEBHOOK) {
    console.log('  No notification channels configured — alerts logged locally only');
  }
});
