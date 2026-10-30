import { uploadAllowed } from '../export/image-validation.js';
import SftpClient from 'ssh2-sftp-client';
import { readFile } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import type { DataPreview } from '../export/data-preview.js';

export class UploadError extends Error {
  constructor(message = 'SFTP-Upload fehlgeschlagen. Prüfe Verbindung, Server-Fingerabdruck, Zugang und Schreibrechte.') { super(message); }
}
const schema = z.object({ host: z.string().trim().min(1), port: z.coerce.number().int().min(1).max(65535),
  username: z.string().trim().min(1), directory: z.string().startsWith('/').refine((s) => !s.includes('\\') && !s.includes('\0') && !s.split('/').includes('..')),
  fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}=?$/), password: z.string().optional(), keyPath: z.string().optional(), passphrase: z.string().optional(),
}).refine((s) => Boolean(s.password) !== Boolean(s.keyPath));
export type SftpSettings = z.infer<typeof schema>;
export function readSftpSettings(env: NodeJS.ProcessEnv = process.env): SftpSettings | undefined {
  if (!env.SFTP_HOST?.trim()) return undefined;
  const parsed = schema.safeParse({ host: env.SFTP_HOST, port: env.SFTP_PORT || 22, username: env.SFTP_USERNAME,
    directory: env.SFTP_DIRECTORY, fingerprint: env.SFTP_HOST_FINGERPRINT, password: env.SFTP_PASSWORD || undefined,
    keyPath: env.SFTP_PRIVATE_KEY_PATH || undefined, passphrase: env.SFTP_PRIVATE_KEY_PASSPHRASE || undefined });
  if (!parsed.success) {
    // Nur feste Feldhinweise ausgeben, niemals Eingabewerte oder Zod-Rohfehler.
    const hints: Record<string, string> = {
      host: 'SFTP_HOST: Servername fehlt.',
      port: 'SFTP_PORT: Ganze Zahl zwischen 1 und 65535 erforderlich.',
      username: 'SFTP_USERNAME: Benutzername fehlt oder ist leer.',
      directory: 'SFTP_DIRECTORY: Absoluter SFTP-Pfad erforderlich (beginnend mit /, ohne Backslash oder ..).',
      fingerprint: 'SFTP_HOST_FINGERPRINT: SHA256-Fingerabdruck fehlt oder hat ein falsches Format. Erwartet: SHA256: gefolgt von 43 Base64-Zeichen, optional mit = am Ende.',
    };
    const messages = [...new Set(parsed.error.issues.map((issue) => hints[String(issue.path[0] ?? '')]
      ?? 'Anmeldung: Genau eine Variable setzen: SFTP_PASSWORD oder SFTP_PRIVATE_KEY_PATH.'))];
    throw new UploadError('SFTP-Konfiguration ungültig.\n' + messages.join('\n'));
  }
  return parsed.data;
}
export function verifyHost(key: Buffer, fingerprint: string): boolean {
  const actual = createHash('sha256').update(key).digest();
  const expected = Buffer.from(fingerprint.replace(/^SHA256:/, ''), 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
type Transport = Pick<SftpClient, 'connect' | 'stat' | 'put' | 'end'> & { client: { destroy(): void } };
function uploadFailure(error: unknown, step: string, writing: boolean): UploadError {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const hint = code === 2 || code === 'ENOENT'
    ? 'Zielpfad nicht gefunden. Prüfe SFTP_DIRECTORY und current aus Sicht des SFTP-Kontos. Bei einem Symlink muss auch dessen Ziel innerhalb der erlaubten SFTP-Sicht erreichbar sein.'
    : code === 3 || code === 'EACCES' || code === 'EPERM'
    ? 'Zugriff verweigert. Prüfe Verzeichnisrechte und Schreibrechte der vorhandenen JSON-Dateien für das SFTP-Konto. Der Eigentümer des Symlinks allein genügt nicht.'
    : step === 'Verbindungsaufbau'
    ? 'Prüfe Erreichbarkeit, Host-Fingerabdruck und Anmeldung; bei Schlüsselanmeldung auch die Lesbarkeit der lokalen Schlüsseldatei.'
    : 'Prüfe Zielpfad, Symlink-Ziel, Schreibrechte der vorhandenen Dateien, freien Speicher und Verbindung.';
  return new UploadError(`SFTP-Upload fehlgeschlagen (${step}). ${hint}${writing ? ' Die Dateien können bereits teilweise überschrieben sein. Nach Behebung beide Dateien erneut hochladen.' : ''}`);
}
export class JsonUploader {
  private busy = false;
  constructor(private settings: SftpSettings, private factory: () => Transport = () => new SftpClient() as SftpClient & { client: { destroy(): void } }) {}
  private async connect(client: Transport): Promise<void> {
      const privateKey = this.settings.keyPath ? await readFile(this.settings.keyPath) : undefined;
      await client.connect({ host: this.settings.host, port: this.settings.port, username: this.settings.username,
        ...(privateKey ? { privateKey, ...(this.settings.passphrase ? { passphrase: this.settings.passphrase } : {}) } : { password: this.settings.password! }),
        hostVerifier: (key: Buffer) => verifyHost(key, this.settings.fingerprint), readyTimeout: 15_000,
        keepaliveInterval: 10_000, keepaliveCountMax: 3 });
  }
  async checkConnection(): Promise<void> {
    if (this.busy) throw new UploadError('Ein SFTP-Vorgang läuft bereits.');
    this.busy = true;
    const client = this.factory();
    const timer = setTimeout(() => client.client.destroy(), 30_000);
    try { await this.connect(client); }
    catch { throw new UploadError('SFTP-Verbindungsprüfung fehlgeschlagen. Prüfe Server-Fingerabdruck, Zugang und Erreichbarkeit.'); }
    finally { clearTimeout(timer); await client.end().catch(() => {}); this.busy = false; }
  }
  async upload(data: DataPreview): Promise<string> {
    if (!uploadAllowed(data)) throw new UploadError('Upload gesperrt: Kein erfolgreicher Bilddownload für dieses JSON-Dateipaar.');
    if (this.busy) throw new UploadError('Ein SFTP-Upload läuft bereits.');
    this.busy = true;
    const client = this.factory();
    const target = posix.join(this.settings.directory, 'current');
    let step = 'Verbindungsaufbau';
    let writing = false;
    const timer = setTimeout(() => client.client.destroy(), 120_000);
    try {
      // Ein unveränderlicher JSON-Stand für beide Dateien; keine lokalen Datendateien.
      const groups = Buffer.from(JSON.stringify(data.technicalGroups, null, 2) + '\n');
      const persons = Buffer.from(JSON.stringify(data.technicalPersons, null, 2) + '\n');
      await this.connect(client);
      step = 'Zugriff auf current';
      const info = await client.stat(target);
      if (!info.isDirectory) throw new UploadError('SFTP-Upload nicht möglich: current ist kein erreichbares Verzeichnis. Prüfe SFTP_DIRECTORY und gegebenenfalls das Symlink-Ziel aus Sicht des SFTP-Kontos.');
      step = 'Schreiben von current/groups.json';
      writing = true;
      await client.put(groups, posix.join(target, 'groups.json'), { writeStreamOptions: { flags: 'w', mode: 0o600 } });
      step = 'Schreiben von current/contactPersons.json';
      await client.put(persons, posix.join(target, 'contactPersons.json'), { writeStreamOptions: { flags: 'w', mode: 0o600 } });
      return target;
    } catch (error) { throw error instanceof UploadError ? error : uploadFailure(error, step, writing); }
    finally { clearTimeout(timer); await client.end().catch(() => {}); this.busy = false; }
  }
}
