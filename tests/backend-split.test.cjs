require('./bank-fixture.cjs');
process.env.MATH2_ENV_ID='env-test-only';
process.env.MATH2_ALLOWED_UID='1000000000000000001';
process.env.MATH2_ALLOWED_EMAIL='deployer@example.com';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initial } = require('../functions/math2-api/engine.cjs');
const practice = require('../functions/math2-api/practice.cjs');
const store = require('../functions/math2-api/practice-store.cjs');
const bank = require('../private/data/bank.json');

const first = bank.questions[0];
const second = bank.questions[1];
const moment = '2026-10-01T08:00:00.000Z';
const date = '2026-10-01';
const completion = (state, id, q = first) => ({ id, epoch: state.epoch, kind: 'complete', baseRevision: 0, payload: { date, questionId: q.id, bankId: q.bankId || 'exam', occurredAt: moment, bankVersion: practice.BANK_VERSION } });
async function withTime(fn) { const prior = Date.now; Date.now = () => Date.parse('2026-10-02T08:00:00.000Z'); try { return await fn(); } finally { Date.now = prior; } }

test('practice writes are gated by one meta CAS and lose cleanly to a competing writer', async () => withTime(async () => {
  const state = initial();
  const head = { state, practiceEpoch: state.epoch, practiceSeq: 0, practiceRevision: 0 };
  const sql = [];
  let revision = 0;
  const db = { executePGSql: async ({ Sql }) => {
    sql.push(Sql);
    if (Sql.startsWith('SELECT bucket')) return { Rows: [] };
    if (Sql.startsWith('SELECT id,fingerprint')) return { Rows: [] };
    if (Sql.startsWith('WITH changed AS')) {
      const expected = Number(Sql.match(/AND revision=(\d+) RETURNING id/)[1]);
      if (expected !== revision) return { Rows: [] };
      revision++;
      return { Rows: ['[1]'] };
    }
    throw Error('Unexpected SQL');
  } };
  const loadedA = await store.readPractice(db, head, { practiceOps: [completion(state, 'writer-one-0001')] });
  const loadedB = await store.readPractice(db, head, { practiceOps: [completion(state, 'writer-two-0001', second)] });
  const a = structuredClone(loadedA.state), b = structuredClone(loadedB.state);
  assert.equal(practice.applyPracticeOps(a, { practiceOps: [completion(state, 'writer-one-0001')] }).practiceAck.length, 1);
  assert.equal(practice.applyPracticeOps(b, { practiceOps: [completion(state, 'writer-two-0001', second)] }).practiceAck.length, 1);
  assert.equal(await store.savePractice(db, head, loadedA, { state: a }), true);
  assert.equal(await store.savePractice(db, head, loadedB, { state: b }), false);
  const write = sql.find(item => item.startsWith('WITH changed AS'));
  assert.match(write, /UPDATE math2_private\.practice_meta SET seq=1,revision=revision\+1/);
  assert.match(write, /INSERT INTO math2_private\.practice_buckets/);
  assert.match(write, /INSERT INTO math2_private\.practice_receipts/);
  assert.match(write, /FROM changed/);
}));

test('restores must check both cursors and migration archives both modules before atomic epoch switch', async () => {
  const schema = fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8');
  assert.match(schema, /CREATE OR REPLACE FUNCTION math2_private\.atomic_restore/);
  assert.match(schema, /FROM math2_private\.state WHERE id=1 FOR UPDATE/);
  assert.match(schema, /FROM math2_private\.practice_meta WHERE id=1 FOR UPDATE/);
  assert.match(schema, /INSERT INTO math2_private\.restores/);
  assert.match(schema, /INSERT INTO math2_private\.practice_restores/);
  assert.match(schema, /ON CONFLICT\(epoch,bucket\) DO NOTHING/);
  require('@cloudbase/manager-node');
  const managerId = require.resolve('@cloudbase/manager-node');
  const handlerId = require.resolve('../functions/math2-api/handler.cjs');
  const originalManager = require.cache[managerId].exports;
  const oldFetch = global.fetch;
  const state = initial();
  for (const key of ['dailyCompletions', 'goalTemplates', 'goalOverrides', 'practiceReceipts']) delete state[key];
  const queries = [];
  const db = { executePGSql: async ({ Sql }) => {
    queries.push(Sql);
    if (Sql.startsWith('SELECT s.revision')) return { Rows: [JSON.stringify([0, state, 0, state.epoch, 5])] };
    if (Sql.startsWith('SELECT bucket')) return { Rows: [] };
    if (Sql.startsWith('SELECT math2_private.atomic_restore')) return { Rows: ['["true"]'] };
    throw Error('Unexpected SQL');
  } };
  try {
    require.cache[managerId].exports = { init: () => ({ database: db }) };
    delete require.cache[handlerId];
    const handler = require(handlerId);
    global.fetch = async () => new Response(JSON.stringify({ sub: '1000000000000000001', email: 'deployer@example.com', status: 'ACTIVE' }));
    const base = { action: 'restore', practiceVersion: 1, clientVersion: 2, accessToken: 'test-token-not-real', epoch: state.epoch, expectedSeq: 0, records: [] };
    assert.equal((await handler.main({ ...base, expectedPracticeCursor: 4 })).error, 'PREVIEW_CHANGED');
    assert.equal(queries.some(query => query.startsWith('SELECT math2_private.atomic_restore')), false);
    const accepted = await handler.main({ ...base, expectedPracticeCursor: 5 });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.practiceFull, true);
    assert.notEqual(accepted.epoch, state.epoch);
    assert(queries.some(query => query.startsWith('SELECT math2_private.atomic_restore')));
    const recovery = { ...base, expectedPracticeCursor: 5, recoveryVersion: 1, restoreId: 'confirmed-recovery-001', expectedStateRevision: 0, expectedPracticeRevision: 0 };
    const count = () => queries.filter(query => query.startsWith('SELECT math2_private.atomic_restore')).length;
    const before = count();
    assert.equal((await handler.main({ ...recovery, expectedStateRevision: 1 })).error, 'PREVIEW_CHANGED');
    assert.equal((await handler.main({ ...recovery, expectedPracticeRevision: 1 })).error, 'PREVIEW_CHANGED');
    assert.equal((await handler.main({ ...recovery, pendingPracticeOperations: [{ id: 'old-queue' }] })).error, 'INVALID_PRACTICE_BACKUP');
    assert.equal(count(), before);
    const confirmed = await handler.main(recovery);
    assert.equal(confirmed.ok, true);assert.equal(confirmed.full, true);assert.equal(confirmed.epoch, recovery.restoreId);
    state.epoch = recovery.restoreId;
    const repeated = await handler.main(recovery);
    assert.equal(repeated.ok, true);assert.equal(repeated.epoch, recovery.restoreId);assert.equal(count(), before + 1);
  } finally {
    global.fetch = oldFetch;
    require.cache[managerId].exports = originalManager;
    delete require.cache[handlerId];
  }
});
