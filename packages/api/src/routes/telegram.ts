import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { decryptCredential } from '@bothive/core';
import { enqueueTelegramUpdate } from '../services/queue.js';

/**
 * Constant-time string comparison. The webhook URL and the
 * `X-Telegram-Bot-Api-Secret-Token` header both carry the bot token, so a
 * timing side channel on the comparison must not leak how close an attacker's
 * guess is. Hash both sides first: the inputs differ in length.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Telegram webhook receiver. Deliberately public — Telegram itself calls this
 * endpoint, so it must not sit behind requireAuth. Access is gated by the bot
 * token: it appears in the URL (standard Telegram webhook practice, the token
 * is a 46-char secret) and is verified again against the
 * `X-Telegram-Bot-Api-Secret-Token` header, which Telegram echoes back only
 * when it was set via setWebhook. Any failure answers 404 with the same body
 * so nothing can be learned about which part of the check failed.
 */
export async function telegramRoutes(app: FastifyInstance) {
  app.post<{ Params: { botId: string; token: string } }>(
    '/webhook/:botId/:token',
    async (request, reply) => {
      const { botId, token } = request.params;

      const bot = await request.prisma.bot.findUnique({
        where: { id: botId },
        include: { account: true },
      });
      if (!bot || bot.platform !== 'telegram') {
        return reply.status(404).send({ ok: false, error: 'Not found' });
      }

      const accountToken = decryptCredential(bot.account.token);
      if (!accountToken || !safeEqual(accountToken, token)) {
        return reply.status(404).send({ ok: false, error: 'Not found' });
      }

      const secretHeader = request.headers['x-telegram-bot-api-secret-token'];
      const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
      if (!secret || !safeEqual(token, secret)) {
        return reply.status(404).send({ ok: false, error: 'Not found' });
      }

      const body = request.body;
      if (
        typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        typeof (body as { update_id?: unknown }).update_id !== 'number'
      ) {
        return reply.status(400).send({ ok: false, error: 'Invalid update payload' });
      }

      try {
        await enqueueTelegramUpdate(botId, body as Record<string, unknown>);
      } catch (err) {
        console.error(`[api] Telegram webhook enqueue failed for ${botId}:`, err);
        return reply.status(502).send({ ok: false, error: 'Queue unavailable' });
      }

      return { ok: true };
    },
  );
}
