import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { CollectionRunner, startCollectionScheduler } from '../modules/automation/collection.scheduler.js';

describe('collection scheduler', () => {
  it('prevents overlapping runs and emits lifecycle events', async () => {
    let finish!: (value: any) => void;
    const work = new Promise((resolve) => { finish = resolve; });
    const events = new EventEmitter();
    const statuses: string[] = [];
    events.on('collection', (event) => statuses.push(event.status));
    const runner = new CollectionRunner(async () => await work as never, events);
    const first = runner.trigger(['fixture']);
    await expect(runner.trigger(['fixture'])).resolves.toMatchObject({ status: 'skipped' });
    finish({ stats: { results: 1 }, persistence: { saved: 1, changes: 1 } });
    await expect(first).resolves.toMatchObject({ status: 'completed' });
    expect(statuses).toEqual(['started', 'completed']);
  });

  it('stays disabled unless scheduling is configured', () => {
    expect(startCollectionScheduler()).toBeUndefined();
  });
});

