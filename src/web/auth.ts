import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

const derive = promisify(scrypt);
export const accountSchema = z.strictObject({
  username: z.string().trim().min(1).max(80),
  salt: z.string().regex(/^[a-f0-9]{32}$/),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Account = z.infer<typeof accountSchema>;

export async function createAccount(username: string, password: string): Promise<Account> {
  if (password.length < 12 || password.length > 256) throw new Error('Das Passwort muss 12 bis 256 Zeichen haben.');
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 32)) as Buffer;
  return accountSchema.parse({ username, salt, hash: hash.toString('hex') });
}

export async function verifyAccount(account: Account, username: string, password: string): Promise<boolean> {
  if (password.length > 256) return false;
  const hash = (await derive(password, account.salt, 32)) as Buffer;
  return timingSafeEqual(hash, Buffer.from(account.hash, 'hex')) && username === account.username;
}
