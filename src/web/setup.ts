import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createAccount } from './auth.js';

async function password(prompt: string): Promise<string> {
  if (!stdin.isTTY) throw new Error('Bitte in einem interaktiven Terminal ausführen.');
  stdout.write(prompt);
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    function finish() { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); }
    function onData(chunk: string) {
      for (const char of chunk) {
        if (char === '\u0003') { finish(); reject(new Error('Abgebrochen.')); return; }
        if (char === '\r' || char === '\n') { finish(); resolve(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 257) value += char;
      }
    }
    stdin.on('data', onData);
  });
}

try {
  if (!stdin.isTTY) throw new Error('Bitte in einem interaktiven Terminal ausführen.');
  const reader = createInterface({ input: stdin, output: stdout });
  const username = await reader.question('Benutzername: ');
  reader.close();
  const secret = await password('Passwort (mindestens 12 Zeichen, Eingabe unsichtbar): ');
  if (secret !== await password('Passwort wiederholen: ')) throw new Error('Die Passwörter stimmen nicht überein.');
  const account = await createAccount(username, secret);
  await mkdir('config', { recursive: true });
  await writeFile('config/local.json', JSON.stringify(account, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Zugang angelegt. Starte die Oberfläche mit npm start.');
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(code === 'EEXIST' ? 'Es besteht bereits ein Zugang in config/local.json. Die Datei wurde nicht überschrieben.'
    : error instanceof Error ? error.message : 'Zugang konnte nicht angelegt werden.');
  process.exitCode = 1;
}
