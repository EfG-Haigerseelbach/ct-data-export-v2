import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { accountSchema } from './auth.js';
import { readCtConfig } from '../churchtools/config.js';

export type EnvironmentInfo = { baseUrl: string | undefined; tokenSet: boolean; tokenNonEmpty: boolean; sftp?: { host: string | undefined; port: string | undefined; directory: string | undefined; fingerprint: string | undefined } };

export function readEnvironmentInfo(env: NodeJS.ProcessEnv): EnvironmentInfo {
  return { baseUrl: env.CT_BASE_URL, tokenSet: env.CT_API_TOKEN !== undefined,
    tokenNonEmpty: Boolean(env.CT_API_TOKEN?.trim()),
    sftp: { host: env.SFTP_HOST, port: env.SFTP_PORT, directory: env.SFTP_DIRECTORY, fingerprint: env.SFTP_HOST_FINGERPRINT } };
}

export class StartupError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'StartupError'; }
}

export function parseAccountFile(text: string) {
  let input: unknown;
  try { input = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown; }
  catch { throw new StartupError('ACCOUNT_JSON', 'config/local.json enthält kein gültiges JSON. Prüfe die Dateistruktur.'); }
  // Nur die drei Kontofelder übernehmen; Zusatzfelder sind keine Anmeldedaten
  // und werden weder an den Webserver noch an den CT-Adapter weitergegeben.
  const parsed = accountSchema.strip().safeParse(input);
  if (!parsed.success) throw new StartupError('ACCOUNT_INVALID',
    'config/local.json benötigt einen gültigen Benutzernamen, Salt und Passworthash. Verwende den mit npm.cmd run user:create angelegten Zugang.');
  const ignoredFields = Object.keys(input as Record<string, unknown>).filter((key) => !['username', 'salt', 'hash'].includes(key)).length;
  return { account: parsed.data, ignoredFields };
}

export function parseWebEnvironment(env: NodeJS.ProcessEnv) {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new StartupError('PORT_INVALID', 'PORT muss eine ganze Zahl zwischen 1 und 65535 sein.');
  let ctConfig;
  try {
    // Ohne vollständige Zugangsdaten läuft die Weboberfläche ohne CT-Adapter.
    if (env.CT_BASE_URL?.trim() && env.CT_API_TOKEN?.trim()) ctConfig = readCtConfig(env);
  }
  catch {
    throw new StartupError('CT_CONFIG', 'CT-Konfiguration ungültig. Prüfe die HTTPS-Instanz-URL ohne /api und die numerischen CT-Limits.');
  }
  if (env.CT_WEB_SECURE_COOKIE !== undefined && !['true', 'false'].includes(env.CT_WEB_SECURE_COOKIE)) {
    throw new StartupError('COOKIE_CONFIG', 'CT_WEB_SECURE_COOKIE muss true oder false sein.');
  }
  let publicBaseUrl: string;
  try {
    const url = new URL(env.APP_PUBLIC_BASE_URL || `http://127.0.0.1:${port}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error();
    publicBaseUrl = url.href.replace(/\/$/, '');
  } catch { throw new StartupError('PUBLIC_URL', 'APP_PUBLIC_BASE_URL muss eine absolute HTTP(S)-Adresse ohne Zugangsdaten, Query oder Fragment sein.'); }
  return { headerLabel: env.APP_HEADER_LABEL?.trim() ?? '', publicBaseUrl, port, ctConfig, environmentInfo: readEnvironmentInfo(env),
    directory: resolve(env.CT_EXPORT_DIRECTORY ?? 'var/import'),
    secureCookie: env.CT_WEB_SECURE_COOKIE === 'true' };
}

export async function loadWebSettings(env: NodeJS.ProcessEnv = process.env, accountPath = resolve('config/local.json')) {
  let text: string;
  try { text = await readFile(accountPath, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StartupError('ACCOUNT_MISSING',
      'Lokaler Webzugang fehlt. Führe im Verzeichnis app zuerst npm.cmd run user:create aus.');
    throw new StartupError('ACCOUNT_UNREADABLE', 'config/local.json kann nicht gelesen werden. Prüfe die Dateiberechtigungen.');
  }
  return { ...parseAccountFile(text), ...parseWebEnvironment(env) };
}
