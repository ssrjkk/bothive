import { z } from 'zod';
import { isValidProxyUrl } from '../proxy/proxy-validator.js';

export const ProxyTypeSchema = z.enum(['http', 'socks5']);

export const CreateProxySchema = z.object({
  url: z.string().min(1).max(500).refine(isValidProxyUrl, { message: 'must be a valid http:// or socks5:// proxy URL' }),
  type: ProxyTypeSchema,
  priority: z.number().int().min(0).max(100).default(0),
});

export const UpdateProxySchema = z.object({
  url: z.string().min(1).max(500).refine(isValidProxyUrl, { message: 'must be a valid http:// or socks5:// proxy URL' }).optional(),
  type: ProxyTypeSchema.optional(),
  priority: z.number().int().min(0).max(100).optional(),
  enabled: z.boolean().optional(),
});
