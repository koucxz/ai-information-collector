import { Router } from 'express';
import { createBackup, exportInformationCsv, restoreBackup } from './data.service.js';

export const dataRouter = Router();
dataRouter.get('/export', (request, response) => {
  if (request.query.format === 'csv') {
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="signaldock-information.csv"');
    return response.send(`\ufeff${exportInformationCsv()}`);
  }
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${request.query.format === 'backup' ? 'signaldock-backup.json' : 'signaldock-information.json'}"`);
  return response.send(JSON.stringify(createBackup()));
});
dataRouter.get('/backup', (_request, response) => {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Disposition', 'attachment; filename="signaldock-backup.json"');
  return response.send(JSON.stringify(createBackup()));
});
dataRouter.post('/restore', (request, response) => { try { return response.json({ data: restoreBackup(request.body) }); } catch (error) { return response.status(400).json({ error: error instanceof Error ? error.message : '恢复失败' }); } });
