import { ChurchToolsApi, CtError } from './client.js';
import { readCtConfig } from './config.js';

try {
  const config = readCtConfig();
  if (!config) throw new Error('CT_BASE_URL und CT_API_TOKEN fehlen.');
  await new ChurchToolsApi(config).checkConnection();
  console.log(JSON.stringify({ status: 'connected', message: 'ChurchTools-Anmeldung erfolgreich.' }));
} catch (error) {
  console.error(JSON.stringify({ status: 'error', code: error instanceof CtError ? error.code : 'CT_CONFIG',
    message: error instanceof CtError ? error.message : 'CT-Konfiguration fehlt oder ist ungültig.' }));
  process.exitCode = 1;
}
