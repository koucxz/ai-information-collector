import 'dotenv/config';
import { createServer } from 'node:http';
import { env } from './config/env.js';
import { app } from './app.js';
import { startCollectionScheduler } from './modules/automation/collection.scheduler.js';
import { startDigestScheduler } from './modules/automation/digest.scheduler.js';
import { attachRealtime } from './realtime.js';

const server = createServer(app);
attachRealtime(server);
startCollectionScheduler();
startDigestScheduler();

server.listen(env.PORT, () => {
  console.log(`SignalDock server running at http://localhost:${env.PORT}`);
});
