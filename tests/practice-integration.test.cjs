require('./bank-fixture.cjs');
require('fake-indexeddb/auto');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const stores = ['records', 'meta', 'ops', 'dailyCompletions', 'goalTemplates', 'goalOverrides', 'practiceOps'];
const date = '2026-09-26';
const occurredAt = '2026-09-26T03:00:00.000Z';
const questionId = 'cxyonly:1';

async function modules() {
  const [storage, daily, core] = await Promise.all([
    import('../public/storage.js'),
    import('../public/daily-data.js'),
    import('../public/core.js')
  ]);
  return { storage, daily, core };
}

async function fresh() {
  const { storage, daily, core } = await modules();
  const db = await storage.openDB();
  await storage.transact(db, stores, tx => {
    for (const name of stores) tx.objectStore(name).clear();
  });
  await storage.acceptSync(db, {
    epoch: 'practice-integration-epoch', seq: 0, practiceCursor: 0,
    full: true, practiceFull: true, records: [], dailyCompletions: [],
    goalTemplates: [], goalOverrides: [], capabilities: { practice: 1 },
    practiceEnabledFrom: date
  });
  return { db, storage, daily, core };
}

const completion = { date, questionId, bankId: 'exam', occurredAt, bankVersion: 'fixture-bank' };

test('T19: a failed practice queue write rolls back the completion and its local order', async () => {
  const { db, storage, daily } = await fresh();
  const originalPut = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'practiceOps') throw Error('simulated practice queue write failure');
      return originalPut.apply(this, args);
    };
    await assert.rejects(daily.saveCompletion(db, completion), /simulated practice queue write failure/);
  } finally {
    IDBObjectStore.prototype.put = originalPut;
  }
  try {
    const snap = await storage.snapshot(db);
    assert.deepEqual(snap.dailyCompletions, []);
    assert.deepEqual(snap.practiceOps, []);
    assert.equal(await storage.getMeta(db, 'practiceOrder'), undefined);
    await daily.saveCompletion(db, completion);
    assert.equal((await storage.snapshot(db)).dailyCompletions.filter(x => x.completed).length, 1);
  } finally {
    db.close();
  }
});

test('T22: merging v1 and v2 backups preserves daily history, plans, and the pending queue', async () => {
  const { db, storage, daily, core } = await fresh();
  try {
    await daily.saveCompletion(db, completion);
    await daily.saveGoalTemplate(db, {
      effectiveFrom: '2026-09-27', mode: 'simple',
      tasks: [{ taskId: 'fixture-task', bankId: 'all', categoryIds: [],
        targetCount: 2, scopeQuestionIds: ['cxyonly:1', 'cxyonly:2'],
        bankVersion: 'fixture-bank', scopeLabels: ['全部题库'] }]
    });
    await daily.saveGoalOverride(db, { date, mode: 'rest' });
    const before = await storage.snapshot(db);
    for (const schemaVersion of [1, 2]) {
      const incoming = core.validateBackup({
        app: 'math2-practice', schemaVersion, bankVersion: 'older-bank',
        records: [{ ...core.blank(`cxyonly:${schemaVersion + 1}`), note: `legacy-${schemaVersion}` }]
      });
      await storage.importRecords(db, incoming, 'merge', await storage.snapshot(db));
      const after = await storage.snapshot(db);
      assert.deepEqual(after.dailyCompletions, before.dailyCompletions);
      assert.deepEqual(after.goalTemplates, before.goalTemplates);
      assert.deepEqual(after.goalOverrides, before.goalOverrides);
      assert.deepEqual(after.practiceOps, before.practiceOps);
      assert.equal(after.records.get(`cxyonly:${schemaVersion + 1}`).note, `legacy-${schemaVersion}`);
    }
    assert.equal((await daily.loadPractice(db)).dailyCompletions.filter(x => x.completed).length, 1);
  } finally {
    db.close();
  }
});

test('a rejected completion is replaced by the full cloud snapshot while its operation remains reviewable', async () => {
  const { db, storage, daily } = await fresh();
  try {
    await daily.saveCompletion(db, completion);
    const op = (await storage.snapshot(db)).practiceOps[0];
    const remote = { ...completion, completed: false, revision: 7, receivedAt: occurredAt,
      categoryIdsSnapshot: [] };
    await storage.acceptSync(db, {
      epoch: 'practice-integration-epoch', seq: 7, practiceCursor: 7,
      practiceFull: true, records: [], dailyCompletions: [remote],
      goalTemplates: [], goalOverrides: [], practiceAck: [],
      practiceErrors: [{ id: op.id, error: 'PRACTICE_CONFLICT', current: remote }],
      capabilities: { practice: 1 }, practiceEnabledFrom: date
    });
    const snap = await storage.snapshot(db);
    assert.equal(snap.dailyCompletions.length, 1);
    assert.equal(snap.dailyCompletions[0].completed, false);
    assert.equal(snap.dailyCompletions[0].revision, 7);
    assert.equal(snap.practiceOps.length, 1);
    assert.equal(snap.practiceOps[0].blocked, 'PRACTICE_CONFLICT');
    assert.deepEqual(snap.practiceOps[0].remote, remote);
  } finally {
    db.close();
  }
});

test('a pending completion survives closing and reopening the upgraded database', async () => {
  const { db, storage, daily } = await fresh();
  await daily.saveCompletion(db, completion);
  const before = await storage.snapshot(db);
  db.close();
  const reopened = await storage.openDB();
  try {
    const after = await storage.snapshot(reopened);
    assert.equal(reopened.version, 2);
    assert.deepEqual(after.dailyCompletions, before.dailyCompletions);
    assert.deepEqual(after.practiceOps, before.practiceOps);
  } finally {
    reopened.close();
  }
});

test('v3 cloud merge keeps distinct completions, tombstones, and goal versions without duplicating stable keys', async () => {
  const { core } = await modules();
  const task = targetCount => ({ taskId: 'merge-task', bankId: 'all', categoryIds: [],
    targetCount, scopeQuestionIds: ['cxyonly:1', 'cxyonly:2'],
    bankVersion: 'fixture-bank', scopeLabels: ['全部题库'] });
  const row = (id, completed) => ({ date, questionId: id, bankId: 'exam',
    completed, occurredAt, categoryIdsSnapshot: [], bankVersion: 'fixture-bank', revision: 1 });
  const cloudGoal = { id: 'cloud-goal', effectiveFrom: date, mode: 'simple',
    tasks: [task(1)], revision: 1, createdAt: occurredAt };
  const importGoal = { id: 'import-goal', effectiveFrom: '2026-09-27', mode: 'simple',
    tasks: [task(2)], revision: 2, createdAt: occurredAt };
  const backup = core.validateBackup({ app: 'math2-practice', schemaVersion: 3,
    bankVersion: 'fixture-bank', records: [], dailyCompletions: [row('cxyonly:1', true), row('cxyonly:2', false)],
    goalTemplates: [importGoal], goalOverrides: [], pendingPracticeOperations: [] });
  const preview = { full: true, practiceFull: true, records: [],
    dailyCompletions: [row('cxyonly:1', true)], goalTemplates: [cloudGoal], goalOverrides: [] };
  const merged = core.mergeBackupForRestore(backup, preview);
  assert.deepEqual(merged.dailyCompletions.map(x => [x.questionId, x.completed]),
    [['cxyonly:1', true], ['cxyonly:2', false]]);
  assert.deepEqual(merged.goalTemplates.map(x => x.id), ['cloud-goal', 'import-goal']);
  assert.equal(merged.pendingPracticeOperations.length, 0);
  assert.throws(() => core.mergeBackupForRestore({ ...backup,
    dailyCompletions: [row('cxyonly:1', false)] }, preview), /完成与撤销状态冲突/);
  assert.throws(() => core.mergeBackupForRestore({ ...backup,
    goalTemplates: [{ ...cloudGoal, tasks: [task(2)] }] }, preview), /默认目标版本.*冲突/);
  assert.throws(() => core.mergeBackupForRestore({ ...backup,
    pendingPracticeOperations: [{ id: 'blocked-op', epoch: 'old', kind: 'undo', payload: { date, questionId } }] }, preview), /待同步的每日操作/);
});
