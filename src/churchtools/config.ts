import { z } from 'zod';

const schema = z.object({
  baseUrl: z.string().url(), loginToken: z.string().trim().min(1).max(4096),
  requestTimeoutMs: z.coerce.number().int().min(50).max(60_000).default(15_000),
  operationTimeoutMs: z.coerce.number().int().min(50).max(300_000).default(60_000),
  maxPages: z.coerce.number().int().min(1).max(1000).default(100),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  maxRetries: z.coerce.number().int().min(0).max(3).default(2),
});
export type CtConfig = z.infer<typeof schema>;

export function validateCtConfig(input: unknown, allowHttpLoopback = false): CtConfig {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('CT-Konfiguration ungültig. Prüfe URL, Token und numerische Limits.');
  const url = new URL(result.data.baseUrl);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowHttpLoopback && loopback && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash || /\/api\/?$/.test(url.pathname)) {
    throw new Error('CT_BASE_URL muss eine HTTPS-Instanz-URL ohne Zugangsdaten, Query oder /api sein.');
  }
  return { ...result.data, baseUrl: url.href.replace(/\/$/, '') };
}

export function readCtConfig(env: NodeJS.ProcessEnv = process.env): CtConfig | undefined {
  if (!env.CT_BASE_URL && !env.CT_API_TOKEN) return undefined;
  return validateCtConfig({ baseUrl: env.CT_BASE_URL, loginToken: env.CT_API_TOKEN,
    requestTimeoutMs: env.CT_REQUEST_TIMEOUT_MS, operationTimeoutMs: env.CT_OPERATION_TIMEOUT_MS,
    maxPages: env.CT_MAX_PAGES, pageSize: env.CT_PAGE_SIZE, maxRetries: env.CT_MAX_RETRIES,
  });
}
