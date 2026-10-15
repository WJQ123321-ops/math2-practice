require('./bank-fixture.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initial, apply } = require('../functions/math2-api/engine.cjs');
const { BANK_VERSION, idsForScope, beijingDate } = require('../functions/math2-api/practice.cjs');
const bank = require('../private/data/bank.json');

const moment = '2026-10-01T08:00:00.000Z';
const later = '2026-10-02T08:00:00.000Z';
const first = bank.questions[0];
const second = bank.questions[1];
const date = beijingDate(moment);
const nextDate = beijingDate(later);
const asRequest = (state, ops, cursor = 0) => ({ epoch: state.epoch, practiceVersion: 1, practiceCursor: cursor, practiceOps: ops });
const complete = (state, id, question = first, at = moment, baseRevision = 0) => ({ id, epoch: state.epoch, kind: 'complete', baseRevision, payload: { date: beijingDate(at), questionId: question.id, bankId: question.bankId || 'exam', occurredAt: at, bankVersion: BANK_VERSION } });
const undo = (state, id, question = first, at = moment, baseRevision = 0) => ({ id, epoch: state.epoch, kind: 'undo', baseRevision, payload: { date: beijingDate(at), questionId: question.id } });
const task = (id, bankId, categoryIds, targetCount) => ({ taskId: id, bankId, categoryIds, targetCount, scopeQuestionIds: idsForScope(bankId, categoryIds), bankVersion: BANK_VERSION, scopeLabels: [] });
const template = (state, id, tasks, baseRevision = 0, effectiveFrom = date, mode = 'scoped') => ({ id, epoch: state.epoch, kind: 'setGoalTemplate', baseRevision, payload: { id: `plan-${id}`, effectiveFrom, mode, tasks } });
function withServerDay(instant, fn) {
  const original = Date.now;
  Date.now = () => new Date(instant).valueOf();
  try { return fn(); } finally { Date.now = original; }
}

test('daily completion counts unique question IDs by Beijing day and retries idempotently', () => withServerDay(later, () => {
  let state = initial();
  const a = complete(state, 'complete-a-001');
  const b = complete(state, 'complete-b-001', second);
  let result = apply(state, asRequest(state, [a, b, a]));
  state = result.state;
  assert.deepEqual(result.response.practiceAck, [a.id, b.id, a.id]);
  assert.equal(Object.values(state.dailyCompletions).filter(x => x.completed).length, 2);
  const otherDevice = complete(state, 'device-two-001');
  result = apply(state, asRequest(state, [otherDevice], state.seq));
  state = result.state;
  assert.equal(Object.values(state.dailyCompletions).filter(x => x.completed).length, 2);
  assert.equal(result.response.practiceAck.length, 1);
  assert.equal(result.response.dailyCompletions.length, 0);
  const tomorrow = complete(state, 'complete-day-002', first, later);
  state = apply(state, asRequest(state, [tomorrow])).state;
  assert.equal(Object.values(state.dailyCompletions).filter(x => x.completed).length, 3);
  assert.equal(state.dailyCompletions[`${date}|${first.id}`].date, date);
  assert.equal(state.dailyCompletions[`${nextDate}|${first.id}`].date, nextDate);
}));

test('same-batch complete, undo and redo resolve local operation ID bases', () => withServerDay(later, () => {
  const state = initial();
  const a = complete(state, 'complete-chain-001');
  const b = undo(state, 'undo-chain-0001', first, moment, a.id);
  const c = complete(state, 'redo-chain-0001', first, moment, b.id);
  const result = apply(state, asRequest(state, [a, b, c]));
  assert.deepEqual(result.response.practiceAck, [a.id, b.id, c.id]);
  assert.equal(result.state.dailyCompletions[`${date}|${first.id}`].completed, true);
  assert.equal(result.state.dailyCompletions[`${date}|${first.id}`].revision, 3);
}));

test('old undo cannot erase a newer redo; errors leave operation unacknowledged', () => withServerDay(later, () => {
  let state = initial();
  const a = complete(state, 'complete-old-001');
  state = apply(state, asRequest(state, [a])).state;
  const oldUndo = undo(state, 'undo-stale-0001', first, moment, 1);
  const validUndo = undo(state, 'undo-valid-0001', first, moment, 1);
  state = apply(state, asRequest(state, [validUndo])).state;
  const redo = complete(state, 'redo-newer-0001', first, moment, 2);
  state = apply(state, asRequest(state, [redo])).state;
  const result = apply(state, asRequest(state, [oldUndo]));
  assert.equal(result.response.practiceErrors[0].error, 'PRACTICE_CONFLICT');
  assert.equal(result.response.practiceErrors[0].current.revision, 3);
  assert.equal(result.state.dailyCompletions[`${date}|${first.id}`].completed, true);
  assert.equal(result.response.practiceAck.length, 0);
}));

test('server validates packaged question identity, time and operation identity', () => withServerDay(later, () => {
  let state = initial();
  const a = complete(state, 'complete-safe-001');
  state = apply(state, asRequest(state, [a])).state;
  const reused = { ...a, payload: { ...a.payload, questionId: second.id } };
  assert.equal(apply(state, asRequest(state, [reused])).response.practiceErrors[0].error, 'OP_ID_REUSED');
  const unknown = complete(state, 'complete-bad-0001', { id: 'cxyonly:999999' });
  assert.equal(apply(state, asRequest(state, [unknown])).response.practiceErrors[0].error, 'UNKNOWN_QUESTION');
  const badBank = complete(state, 'complete-bad-0002'); badBank.payload.bankId = 'lilin880';
  assert.equal(apply(state, asRequest(state, [badBank])).response.practiceErrors[0].error, 'INVALID_PRACTICE_OP');
  const badDay = complete(state, 'complete-bad-0003'); badDay.payload.date = nextDate;
  assert.equal(apply(state, asRequest(state, [badDay])).response.practiceErrors[0].error, 'INVALID_PRACTICE_DATE');
  const oldVersion = complete(state, 'complete-old-bank-01', second); oldVersion.payload.bankVersion = 'prior-bank-version'; oldVersion.payload.categoryIdsSnapshot = ['older:category'];
  const accepted = apply(state, asRequest(state, [oldVersion]));
  assert.deepEqual(accepted.response.practiceAck, [oldVersion.id]);
  assert.equal(accepted.state.dailyCompletions[`${date}|${second.id}`].bankVersion, 'prior-bank-version');
  assert.deepEqual(accepted.state.dailyCompletions[`${date}|${second.id}`].categoryIdsSnapshot, ['older:category']);
}));

test('goal scope uses real category ancestry, rejects overlap and impossible targets', () => withServerDay(moment, () => {
  let state = initial();
  const chapter = task('chapter-task-001', 'lilin880', ['demo:vol01:ch01'], 1);
  assert(chapter.scopeQuestionIds.length >= 5);
  const duplicate = { ...chapter, taskId: 'duplicate-task-001', categoryIds: ['demo:vol01:ch01:group01'], scopeQuestionIds: idsForScope('lilin880', ['demo:vol01:ch01:group01']) };
  const overlap = template(state, 'goal-overlap-001', [chapter, duplicate]);
  assert.equal(apply(state, asRequest(state, [overlap])).response.practiceErrors[0].error, 'GOAL_SCOPE_OVERLAP');
  const impossible = { ...chapter, targetCount: chapter.scopeQuestionIds.length + 1 };
  assert.equal(apply(state, asRequest(state, [template(state, 'goal-too-many-01', [impossible])])).response.practiceErrors[0].error, 'INVALID_GOAL');
  const forged = { ...chapter, scopeQuestionIds: chapter.scopeQuestionIds.slice(1) };
  assert.equal(apply(state, asRequest(state, [template(state, 'goal-forged-0001', [forged])])).response.practiceErrors[0].error, 'INVALID_GOAL');
  const good = template(state, 'goal-valid-0001', [chapter]);
  state = apply(state, asRequest(state, [good])).state;
  assert.deepEqual(state.goalTemplates[0].tasks[0].scopeLabels, ['第1章 基础练习']);
}));

test('default versions and day overrides use separate revision checks', () => withServerDay(moment, () => {
  let state = initial();
  const whole = task('simple-all-0001', 'all', [], 20);
  const firstGoal = template(state, 'goal-first-0001', [whole], 0, date, 'simple');
  state = apply(state, asRequest(state, [firstGoal])).state;
  const secondGoal = template(state, 'goal-second-001', [{ ...whole, targetCount: 15 }], 1, nextDate, 'simple');
  state = apply(state, asRequest(state, [secondGoal])).state;
  const stale = template(state, 'goal-stale-0001', [whole], 1, nextDate, 'simple');
  assert.equal(apply(state, asRequest(state, [stale])).response.practiceErrors[0].error, 'PRACTICE_CONFLICT');
  const rest = { id: 'override-rest-001', epoch: state.epoch, kind: 'setGoalOverride', baseRevision: 0, payload: { date, mode: 'rest' } };
  state = apply(state, asRequest(state, [rest])).state;
  assert.equal(state.goalOverrides[date].mode, 'rest');
  const restore = { id: 'override-back-001', epoch: state.epoch, kind: 'setGoalOverride', baseRevision: rest.id, payload: { date, mode: 'default' } };
  state = apply(state, asRequest(state, [restore])).state;
  assert.equal(state.goalOverrides[date].mode, 'default');
  assert.equal(state.goalTemplates.length, 2);
}));

test('old client sync keeps practice state; old restore is blocked; new old-backup restore preserves practice', () => withServerDay(later, () => {
  let state = initial();
  state = apply(state, asRequest(state, [complete(state, 'complete-before-01')])).state;
  const legacy = apply(state, { epoch: state.epoch, ops: [], cursor: 0 });
  assert.deepEqual(legacy.state.dailyCompletions, state.dailyCompletions);
  assert.throws(() => apply(state, { action: 'restore', epoch: state.epoch, expectedSeq: state.seq, records: [] }), /UPGRADE_REQUIRED/);
  const oldEpoch = state.epoch;
  const restored = apply(state, { action: 'restore', practiceVersion: 1, epoch: state.epoch, expectedSeq: state.seq, records: [] });
  assert.notEqual(restored.state.epoch, oldEpoch);
  assert.equal(restored.response.practiceFull, true);
  assert.equal(restored.response.dailyCompletions.length, 1);
  assert.equal(restored.state.dailyCompletions[`${date}|${first.id}`].completed, true);
  assert.equal(apply(restored.state, { epoch: oldEpoch, practiceVersion: 1, practiceOps: [] }).response.stale, true);
}));

test('full practice backup restores history under a new epoch with a full snapshot', () => withServerDay(later, () => {
  let state = initial();
  state = apply(state, asRequest(state, [complete(state, 'complete-backup-01')])).state;
  const whole = task('backup-task-0001', 'all', [], 4);
  state = apply(state, asRequest(state, [template(state, 'backup-goal-0001', [whole], 0, nextDate, 'simple')])).state;
  const practiceBackup = { dailyCompletions: Object.values(state.dailyCompletions), goalTemplates: state.goalTemplates, goalOverrides: [] };
  const sourceEpoch = state.epoch;
  const restored = apply(state, { action: 'restore', practiceVersion: 1, epoch: state.epoch, expectedSeq: state.seq, records: [], practiceBackup });
  assert.notEqual(restored.state.epoch, sourceEpoch);
  assert.equal(restored.response.practiceFull, true);
  assert.equal(restored.response.dailyCompletions.length, 1);
  assert.equal(restored.response.goalTemplates.length, 1);
  assert.equal(restored.response.practiceCursor, restored.state.seq);
  assert.equal(restored.state.practiceReceipts['complete-backup-01'], undefined);
}));

test('restore rejects future completions and malformed plans but preserves unknown future-bank IDs', () => withServerDay(later, () => {
  const state = initial();
  const unknown = { date, questionId: 'cxyonly:999999', bankId: 'exam', completed: true, occurredAt: moment, categoryIdsSnapshot: [], bankVersion: 'later-bank' };
  const base = { action: 'restore', practiceVersion: 1, epoch: state.epoch, expectedSeq: state.seq, records: [] };
  const good = { dailyCompletions: [unknown], goalTemplates: [], goalOverrides: [] };
  const restored = apply(state, { ...base, practiceBackup: good });
  assert.equal(restored.response.dailyCompletions[0].questionId, unknown.questionId);
  assert.equal(restored.response.dailyCompletions[0].bankVersion, 'later-bank');
  const future = { ...unknown, date: '2026-10-03', occurredAt: '2026-10-03T08:00:00.000Z' };
  assert.throws(() => apply(state, { ...base, practiceBackup: { ...good, dailyCompletions: [future] } }), /INVALID_PRACTICE_BACKUP/);
  const malformed = { ...good, goalTemplates: [{ id: 'plan-invalid-0001', effectiveFrom: date, mode: 'simple', tasks: [task('bad-plan-task-01', 'exam', [], 1)] }] };
  assert.throws(() => apply(state, { ...base, practiceBackup: malformed }), /INVALID_PRACTICE_BACKUP/);
}));
