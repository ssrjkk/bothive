import type { FastifyInstance } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { decryptCredential, telegramWebhookSlug } from '@bothive/core';
import { enqueueTelegramUpdate } from '../services/queue.js';

/**
 * Constant-time string comparison. The webhook URL path and the
 * `X-Telegram-Bot-Api-Secret-Token` header both carry secrets, so a timing side
 * channel on the comparison must not leak how close an attacker's guess is.
 * Hash both sides first: the inputs differ in length.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Telegram webhook receiver. Deliberately public — Telegram itself calls this
 * endpoint, so it must not sit behind requireAuth. Access is gated by two
 * independent factors, both checked in constant time:
 *  - the URL path slug, which is derived IRREVERSIBLY from the bot token
 *    (SHA-256), so a value scraped from access logs can never reveal the token;
 *  - the `X-Telegram-Bot-Api-Secret-Token` header set via `setWebhook` and
 *    echoed back by Telegram, which must equal the real bot token.
 * An attacker who only knows the (logged) path slug cannot forge the header,
 * so they cannot authenticate. Any failure answers 404 with the same body so
 * nothing can be learned about which part of the check failed.
 */
export async function telegramRoutes(app: FastifyInstance) {
  app.post<{ Params: { botId: string; token: string } }>(
    '/webhook/:botId/:token',
    async (request, reply) => {
      const { botId, token: pathSlug } = request.params;

      const bot = await request.prisma.bot.findUnique({
        where: { id: botId },
        include: { account: true },
      });
      if (!bot || bot.platform !== 'telegram') {
        return reply.status(404).send({ ok: false, error: 'Not found' });
      }

      const accountToken = decryptCredential(bot.account.token);
      if (!accountToken) {
        return reply.status(404).send({ ok: false, error: 'Not found' });
      }

      // The path value is the opaque slug (SHA-256 token), not the token
      // itself. It only gates which bot this routes to; the authoritative
      // authenticator is the header below.
      if (!safeEqual(telegramWebhookSlug(botId, accountToken), pathSlug)) {
        return reply.status(404).send({ ok: false, error: 'Not found' });
      }

      const secretHeader = request.headers['x-telegram-bot-api-secret-token'];
      const secret = Array.isArray(secretHeader) ? secretHeader[0] : secretHeader;
      // The header carries the full bot token; this is the credential check.
      if (!secret || !safeEqual(secret, accountToken)) {
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
        console.error('[api] Telegram webhook enqueue failed', { botId }, err);
        return reply.status(502).send({ ok: false, error: 'Queue unavailable' });
      }

      return { ok: true };
    },
  );
}
