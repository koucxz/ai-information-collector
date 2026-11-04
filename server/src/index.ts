import 'dotenv/config';
import { env } from './config/env.js';
import { app } from './app.js';
import { informationStore } from './modules/collection/information.store.js';

// 多源采集之前入库的条目分数都是 0，启动时按本地规则补一次
const backfilled = informationStore.backfillScores();
if (backfilled > 0) console.log(`已为 ${backfilled} 条历史信息补算相关性分数`);

app.listen(env.PORT, () => {
  console.log(`SignalDock server running at http://localhost:${env.PORT}`);
});
