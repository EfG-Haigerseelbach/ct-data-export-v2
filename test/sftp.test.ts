import { dataHashes } from '../src/export/image-validation.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { JsonUploader, readSftpSettings, UploadError, verifyHost } from '../src/transfer/sftp.js';
import { buildDataPreview } from '../src/export/data-preview.js';
import type SftpClient from 'ssh2-sftp-client';
const key = Buffer.from('synthetic-host-key');
const env = { SFTP_HOST: 'example.org', SFTP_USERNAME: 'export', SFTP_DIRECTORY: '/private/ct', SFTP_PASSWORD: 'synthetic-password',
  SFTP_HOST_FINGERPRINT: 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '') };
const data = buildDataPreview({ groups: [], persons: [], masterData: { groupCategories: [], targetGroups: [] } }, { groups: [], persons: [], warnings: [] }, '2026-10-26T10:00:00Z');
data.imageValidation = { mode:'authenticated-local', checkedAt: new Date().toISOString(), uploadAllowed: true, ...dataHashes(data), errors: [] };
test('SFTP erfordert geprüften Host, Zielpfad und genau eine Anmeldemethode', () => {
  assert.equal(readSftpSettings({}), undefined);
  assert.equal(verifyHost(key, env.SFTP_HOST_FINGERPRINT), true);
  assert.equal(verifyHost(Buffer.from('other'), env.SFTP_HOST_FINGERPRINT), false);
  for (const change of [{ SFTP_HOST_FINGERPRINT: '' }, { SFTP_DIRECTORY: '/private/../public' }, { SFTP_PRIVATE_KEY_PATH: 'key' }, { SFTP_PASSWORD: '' }]) {
    assert.throws(() => readSftpSettings({ ...env, ...change }), UploadError);
  }
});
function transport(fail = false) {
  const calls: string[] = [];
  const files: Buffer[] = [];
  const client = { client: { destroy() {} }, connect: async () => { calls.push('connect'); },
    stat: async (path: string) => { calls.push('stat:' + path); return { isDirectory: true }; },
    mkdir: async (path: string) => { calls.push('mkdir:' + path); },
    put: async (buffer: Buffer, path: string, options: { writeStreamOptions: { flags: string; mode: number } }) => { assert.equal(options.writeStreamOptions.flags, 'w'); assert.equal(options.writeStreamOptions.mode, 0o600); calls.push('put:' + path); files.push(buffer); if (fail && files.length === 2) throw Error('secret'); },
    rename: async (from: string, to: string) => { calls.push('rename:' + from + ':' + to); }, end: async () => { calls.push('end'); } };
  return { calls, files, client: client as unknown as Pick<SftpClient, 'connect' | 'stat' | 'mkdir' | 'put' | 'rename' | 'end'> & { client: { destroy(): void } } };
}
test('Upload überschreibt ausschließlich beide JSON-Dateien im vorhandenen current-Ordner', async () => {
  const fake = transport();
  const target = await new JsonUploader(readSftpSettings(env)!, () => fake.client).upload(data);
  assert.equal(target, '/private/ct/current');
  assert.deepEqual(fake.calls, ['connect', 'stat:/private/ct/current', 'put:/private/ct/current/groups.json', 'put:/private/ct/current/contactPersons.json', 'end']);
  assert.deepEqual(fake.files.map((file) => JSON.parse(file.toString())), [[], []]);
});
test('Fehlgeschlagener zweiter Upload meldet Fehler und gibt Sperre für erneutes Überschreiben frei', async () => {
  const fake = transport(true);
  const uploader = new JsonUploader(readSftpSettings(env)!, () => fake.client);
  await assert.rejects(uploader.upload(data), (error: unknown) => error instanceof UploadError && !error.message.includes('secret'));
  assert.equal(fake.calls.some((call) => call.startsWith('rename:')), false);
  assert.equal(fake.calls.at(-1), 'end');
  assert.equal(await uploader.upload(data), '/private/ct/current');
});


test('Konfigurationsdiagnose nennt fehlerhafte Felder ohne Zugangsdaten', () => {
  try {
    readSftpSettings({ ...env, SFTP_HOST_FINGERPRINT: 'invalid-private-fingerprint', SFTP_PORT: 'invalid-private-port', SFTP_PRIVATE_KEY_PATH: 'private-key-path' });
    assert.fail('Ungültige Konfiguration akzeptiert');
  } catch (error) {
    assert.ok(error instanceof UploadError);
    assert.match(error.message, /SFTP_HOST_FINGERPRINT/);
    assert.match(error.message, /SFTP_PORT/);
    assert.equal(error.message.includes('invalid-private'), false);
    assert.equal(error.message.includes(env.SFTP_PASSWORD), false);
    assert.equal(error.message.includes('private-key-path'), false);
  }
});


test('Verbindungstest verbindet und trennt ohne entfernte Schreiboperationen',async()=>{
 const fake=transport();
 await new JsonUploader(readSftpSettings(env)!,()=>fake.client).checkConnection();
 assert.deepEqual(fake.calls,['connect','end']);assert.equal(fake.files.length,0);
});


test('SFTP sperrt beide Dateien vor Verbindungsaufbau bei ungültiger oder fehlender Bildprüfung',async()=>{
 const fake=transport();const uploader=new JsonUploader(readSftpSettings(env)!,()=>fake.client);
 const blocked=structuredClone(data);blocked.imageValidation!.uploadAllowed=false;
 await assert.rejects(uploader.upload(blocked),/Upload gesperrt/);
 delete blocked.imageValidation;await assert.rejects(uploader.upload(blocked),/Upload gesperrt/);
 const modified=structuredClone(data);modified.technicalGroups.push({id:1,name:'Changed',categories:[],targetGroups:[],ageCategory:'',recurrenceDescription:'',contactPersonIds:[],showOnLandingPage:false,startDate:'',endDate:'',weekday:'',startTime:'',note:'',imageUrl:''});
 await assert.rejects(uploader.upload(modified),/Upload gesperrt/);assert.deepEqual(fake.calls,[]);
});


test('Nicht erreichbares current nennt Pfad-/Chroot-Hinweis ohne Rohfehler und schreibt nichts', async () => {
  const fake = transport();
  fake.client.stat = async () => { throw Object.assign(Error('secret-password'), { code: 2 }); };
  await assert.rejects(new JsonUploader(readSftpSettings(env)!, () => fake.client).upload(data), (error: unknown) => {
    assert.ok(error instanceof UploadError);
    assert.match(error.message, /Zugriff auf current/);
    assert.match(error.message, /SFTP_DIRECTORY/);
    assert.match(error.message, /Symlink/);
    assert.equal(error.message.includes('secret-password'), false);
    return true;
  });
  assert.equal(fake.files.length, 0);
  assert.equal(fake.calls.at(-1), 'end');
});

test('Schreibfehler benennt betroffene Datei, Rechte und möglichen Teilstand', async () => {
  const fake = transport();
  fake.client.put = async () => { throw Object.assign(Error('secret-password'), { code: 3 }); };
  await assert.rejects(new JsonUploader(readSftpSettings(env)!, () => fake.client).upload(data), (error: unknown) => {
    assert.ok(error instanceof UploadError);
    assert.match(error.message, /current\/groups.json/);
    assert.match(error.message, /Zugriff verweigert/);
    assert.match(error.message, /teilweise/);
    assert.equal(error.message.includes('secret-password'), false);
    return true;
  });
});
