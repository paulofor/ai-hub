import { createApp } from './server.js';
import { logWithTimestamp } from './logger.js';

const port = Number.parseInt(process.env.PORT ?? '8083', 10);
const app = createApp();

app.listen(port, () => {
  logWithTimestamp('info', `Sandbox orchestrator listening on port ${port}`);
});
