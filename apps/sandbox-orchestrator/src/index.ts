import { CodexAppServerClient } from './codexAppServerClient.js';
import { createApp } from './server.js';

const port = Number.parseInt(process.env.PORT ?? '8083', 10);
const codexAppServerEnabled = (process.env.CODEX_APP_SERVER_ENABLED ?? 'false').toLowerCase() === 'true';
const codexAppServerClient = codexAppServerEnabled ? new CodexAppServerClient() : undefined;
const app = createApp({ codexAppServerClient });

if (codexAppServerClient) {
  codexAppServerClient.start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Falha ao iniciar Codex App Server: ${message}`);
  });
}

app.listen(port, () => {
  console.log(`Sandbox orchestrator listening on port ${port}`);
});

process.once('SIGTERM', () => {
  codexAppServerClient?.stop().finally(() => process.exit(0));
});
process.once('SIGINT', () => {
  codexAppServerClient?.stop().finally(() => process.exit(0));
});
