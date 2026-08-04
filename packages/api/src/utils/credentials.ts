import { decryptCredential } from '@bothive/core';

interface CredentialSource {
  account: {
    token?: string | null;
    clientId?: string | null;
    secret?: string | null;
    refreshToken?: string | null;
    apiKey?: string | null;
  };
  config?: unknown;
}

export function extractCredentials(bot: CredentialSource): Record<string, unknown> {
  const credentials: Record<string, unknown> = {};
  const token = decryptCredential(bot.account.token);
  if (token) credentials.token = token;
  const clientId = decryptCredential(bot.account.clientId);
  if (clientId) credentials.clientId = clientId;
  const secret = decryptCredential(bot.account.secret);
  if (secret) credentials.clientSecret = secret;
  const refreshToken = decryptCredential(bot.account.refreshToken);
  if (refreshToken) credentials.refreshToken = refreshToken;
  const apiKey = decryptCredential(bot.account.apiKey);
  if (apiKey) credentials.apiKey = apiKey;
  if (bot.config && typeof bot.config === 'object') {
    const cfg = bot.config as Record<string, unknown>;
    if (cfg.channelId) credentials.channelId = cfg.channelId;
    if (cfg.username) credentials.username = cfg.username;
    if (cfg.channel) credentials.channel = cfg.channel;
  }
  return credentials;
}
