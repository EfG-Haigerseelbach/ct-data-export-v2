import { WordpressImports, readWordpressConfig, WordpressError } from '../wordpress/imports.js';
import { JsonArchive, ArchiveError } from '../export/json-archive.js';
import { JsonUploader, readSftpSettings, UploadError } from '../transfer/sftp.js';
import { createWebServer } from './server.js';
import { ChurchToolsApi } from '../churchtools/client.js';
import { loadWebSettings, StartupError } from './config.js';
import { ExportSettingsStore, ExportSettingsError } from '../export/settings.js';
import { WarningStore, WarningStoreError } from '../export/warnings.js';

try {
  const { account, port, ctConfig, directory, secureCookie, ignoredFields, environmentInfo, publicBaseUrl, headerLabel } = await loadWebSettings();
  const exportSettings = await ExportSettingsStore.load();
  const warningStore = await WarningStore.load();
  if (ignoredFields) console.warn('Hinweis: Zusätzliche Felder in config/local.json werden nicht verwendet. CT-Zugangsdaten werden ausschließlich aus der Umgebung gelesen.');
  const archive = await JsonArchive.load();
  const wordpressImports = await WordpressImports.load(readWordpressConfig(), undefined, { urls: exportSettings.snapshot().config.export.wordpress });
  const sftp = readSftpSettings();
  const server = createWebServer({ account,
    directory, headerLabel, wordpressImports, archive, publicBaseUrl, secureCookie, exportSettings, warningStore, environmentInfo,
    ...(sftp ? { uploader: new JsonUploader(sftp) } : {}),
    ...(ctConfig ? { ct: new ChurchToolsApi(ctConfig) } : {}),
  });
  server.on('error', (error: NodeJS.ErrnoException) => {
    console.error(error.code === 'EADDRINUSE'
      ? 'Start nicht möglich [PORT_IN_USE]: Port ist bereits belegt. Beende den anderen Server oder setze PORT auf einen freien Port.'
      : error.code === 'EACCES'
        ? 'Start nicht möglich [PORT_ACCESS]: Keine Berechtigung für den gewählten lokalen Port.'
        : 'Start nicht möglich [SERVER_ERROR]: Der lokale Webserver konnte nicht gestartet werden.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Weboberfläche: http://127.0.0.1:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void wordpressImports.stop().finally(() => server.close()); });
} catch (error) {
  console.error(error instanceof WordpressError || error instanceof ArchiveError || error instanceof UploadError ? error.message : error instanceof StartupError || error instanceof ExportSettingsError || error instanceof WarningStoreError ? `Start nicht möglich [${error.code}]: ${error.message}`
    : 'Start nicht möglich [STARTUP_ERROR]: Unerwarteter Fehler beim Initialisieren des Webservers.');
  process.exitCode = 1;
}
