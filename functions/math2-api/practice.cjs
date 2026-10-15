const crypto = require('node:crypto');
const bank = require('./assets/data/bank.json');
const goalBankHistory = require('./goal-bank-history.json');

const BANK_VERSION = bank.version;
const QUESTION_ID = /^(?:cxyonly:\d+|lilin880:edition-[a-zA-Z0-9-]+:vol\d+:ch\d+:group\d+:(?:single_choice|fill_blank|essay):q\d+)$/;
const OP_ID = /^[a-zA-Z0-9_-]{10,100}$/;
const TASK_ID = /^[a-zA-Z0-9_-]{6,100}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const START_DATE = validDate(process.env.MATH2_PRACTICE_ENABLED_FROM) ? process.env.MATH2_PRACTICE_ENABLED_FROM : '2026-09-26';
function goalBankIndex(source) {
  return { questionById: new Map(source.questions.map(q => [q.id, q])), categoryById: new Map(source.categories.map(c => [String(c.id), c])), allQuestionIds: source.questions.map(q => q.id) };
}
const currentGoalBank = goalBankIndex(bank);
const questionById = new Map([...bank.questions,...(bank.archivedQuestions||[])].map(q=>[q.id,q]));
// These snapshots come from the banks served to older clients. A saved goal
// keeps that version's exact scope instead of silently expanding on upgrade.
const goalBanks = new Map(goalBankHistory.map(source => [source.version, goalBankIndex(source)]));
goalBanks.set(BANK_VERSION, currentGoalBank);

function bankIdOf(q) { return q.bankId || 'exam'; }
function bankIdForQuestionId(id) { return questionById.get(id)?.bankId || (id.startsWith('lilin880:') ? 'lilin880' : 'exam'); }
function validDate(date) {
  if (typeof date !== 'string' || !DATE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
}
function beijingDate(instant) {
  const date = new Date(instant);
  if (Number.isNaN(date.valueOf())) return null;
  return new Date(date.valueOf() + 8 * 3600000).toISOString().slice(0, 10);
}
function completionKey(date, questionId) { return `${date}|${questionId}`; }
function ensurePracticeState(state) {
  state.dailyCompletions ||= {};
  state.goalTemplates ||= [];
  state.goalOverrides ||= {};
  state.practiceReceipts ||= {};
}
function snapshot(state, cursor = 0, full = false) {
  ensurePracticeState(state);
  const after = full ? -1 : (Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0);
  return {
    practiceCursor: state.seq,
    ...(full ? { practiceFull: true } : {}),
    dailyCompletions: Object.values(state.dailyCompletions).filter(x => x.revision > after),
    goalTemplates: state.goalTemplates.filter(x => x.revision > after),
    goalOverrides: Object.values(state.goalOverrides).filter(x => x.revision > after)
  };
}
function categoryAncestors(id, categoryById) {
  const result = new Set();
  let current = String(id);
  while (current && categoryById.has(current) && !result.has(current)) {
    result.add(current);
    const parent = categoryById.get(current).parent_id;
    current = parent == null ? '' : String(parent);
  }
  return result;
}
function idsForScope(bankId, categoryIds, source = currentGoalBank) {
  const { questionById, categoryById, allQuestionIds } = source;
  const selected = new Set(categoryIds);
  return allQuestionIds.filter(id => {
    const q = questionById.get(id);
    if (bankId !== 'all' && bankIdOf(q) !== bankId) return false;
    if (!selected.size) return true;
    return (q.categoryIds || []).some(cid => [...categoryAncestors(cid, categoryById)].some(ancestor => selected.has(ancestor)));
  });
}
function validCategory(bankId, id, categoryById) {
  const c = categoryById.get(id);
  return !!c && (c.bankId || 'exam') === bankId;
}
function sameSet(a, b) {
  return a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x));
}
function validateTasks(tasks, mode, clientVersion) {
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 30) throw Error('INVALID_GOAL');
  if (!['simple', 'scoped'].includes(mode)) throw Error('INVALID_GOAL');
  if (mode === 'simple' && tasks.length !== 1) throw Error('INVALID_GOAL');
  const seenTasks = new Set(), seenQuestions = new Set(), result = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || !TASK_ID.test(task.taskId || '') || seenTasks.has(task.taskId)) throw Error('INVALID_GOAL');
    seenTasks.add(task.taskId);
    if (!['all', 'exam', 'lilin880', 'yanxuan'].includes(task.bankId)) throw Error('INVALID_GOAL');
    if (mode === 'simple' ? task.bankId !== 'all' : task.bankId === 'all') throw Error('INVALID_GOAL');
    if (!Array.isArray(task.categoryIds) || task.categoryIds.length > 50) throw Error('INVALID_GOAL');
    const categoryIds = task.categoryIds.map(String);
    const source = goalBanks.get(task.bankVersion);
    if (!source) throw Error('BANK_VERSION_MISMATCH');
    if (clientVersion === 3 && bank.archivedQuestions?.length && task.bankVersion !== BANK_VERSION) throw Error('BANK_VERSION_MISMATCH');
    if (new Set(categoryIds).size !== categoryIds.length || categoryIds.some(id => id.length > 100 || !validCategory(task.bankId, id, source.categoryById))) throw Error('INVALID_GOAL');
    if (mode === 'simple' && categoryIds.length) throw Error('INVALID_GOAL');
    if (mode === 'scoped' && !categoryIds.length) throw Error('INVALID_GOAL');
    const scope = idsForScope(task.bankId, categoryIds, source);
    if (!scope.length || !Number.isInteger(task.targetCount) || task.targetCount < 1 || task.targetCount > 999 || task.targetCount > scope.length) throw Error('INVALID_GOAL');
    if (!Array.isArray(task.scopeQuestionIds) || !sameSet(task.scopeQuestionIds, scope)) throw Error('INVALID_GOAL');
    for (const id of scope) {
      if (seenQuestions.has(id)) throw Error('GOAL_SCOPE_OVERLAP');
      seenQuestions.add(id);
    }
    const scopeLabels = mode === 'simple' ? ['全部题库'] : categoryIds.map(id => source.categoryById.get(id).name);
    result.push({ taskId: task.taskId, bankId: task.bankId, categoryIds, targetCount: task.targetCount, scopeQuestionIds: scope, bankVersion: task.bankVersion, scopeLabels });
  }
  return result;
}
function resolveBase(state, base, key) {
  if (Number.isSafeInteger(base) && base >= 0) return base;
  if (typeof base === 'string') {
    const receipt = state.practiceReceipts[base];
    return receipt?.key === key ? receipt.revision : null;
  }
  return null;
}
function validateCompletionPayload(payload) {
  if (!payload || !validDate(payload.date) || payload.date < START_DATE || typeof payload.questionId !== 'string' || payload.questionId.length > 200 || !QUESTION_ID.test(payload.questionId)) throw Error('INVALID_PRACTICE_OP');
  const question = questionById.get(payload.questionId);
  if (!question) throw Error('UNKNOWN_QUESTION');
  if (payload.bankId !== bankIdOf(question)) throw Error('INVALID_PRACTICE_OP');
  if (bank.archivedQuestions?.some(q=>q.id===payload.questionId) && (payload.bankVersion === BANK_VERSION || !goalBanks.get(payload.bankVersion)?.questionById.has(payload.questionId))) throw Error('QUESTION_RETIRED');
  if (typeof payload.bankVersion !== 'string' || !payload.bankVersion || payload.bankVersion.length > 200) throw Error('INVALID_PRACTICE_OP');
  if (payload.categoryIdsSnapshot !== undefined && (!Array.isArray(payload.categoryIdsSnapshot) || payload.categoryIdsSnapshot.length > 50 || payload.categoryIdsSnapshot.some(id => typeof id !== 'string' || id.length > 100))) throw Error('INVALID_PRACTICE_OP');
  const occurred = new Date(payload.occurredAt);
  if (typeof payload.occurredAt !== 'string' || Number.isNaN(occurred.valueOf()) || occurred.toISOString() !== payload.occurredAt || beijingDate(occurred) !== payload.date || occurred.valueOf() > Date.now() + 5 * 60000) throw Error('INVALID_PRACTICE_DATE');
  return question;
}
function applyOne(state, op, clientVersion) {
  const payload = op.payload;
  if (op.kind === 'complete' || op.kind === 'undo') {
    let question;
    if (op.kind === 'complete') question = validateCompletionPayload(payload);
    else {
      if (!payload || !validDate(payload.date) || payload.date < START_DATE || typeof payload.questionId !== 'string' || payload.questionId.length > 200 || !QUESTION_ID.test(payload.questionId)) throw Error('INVALID_PRACTICE_OP');
      question = questionById.get(payload.questionId);
      if (!question) throw Error('UNKNOWN_QUESTION');
    }
    const key = completionKey(payload.date, payload.questionId);
    const current = state.dailyCompletions[key];
    const base = resolveBase(state, op.baseRevision, key);
    if (base === null) throw Error('DEPENDENCY_MISSING');
    if (op.kind === 'complete') {
      if (current?.completed) return { key, revision: current.revision };
      if (base !== (current?.revision || 0)) return { conflict: current || null };
      const revision = ++state.seq;
      state.dailyCompletions[key] = { date: payload.date, questionId: payload.questionId, bankId: payload.bankId, completed: true, occurredAt: payload.occurredAt, receivedAt: new Date().toISOString(), categoryIdsSnapshot: payload.categoryIdsSnapshot === undefined ? (question.categoryIds || []).map(String) : payload.categoryIdsSnapshot, bankVersion: payload.bankVersion, revision };
      return { key, revision };
    }
    if (!current) return base === 0 ? { key, revision: 0 } : { conflict: null };
    if (base !== current.revision) return { conflict: current };
    if (!current.completed) return { key, revision: current.revision };
    const revision = ++state.seq;
    state.dailyCompletions[key] = { ...current, completed: false, receivedAt: new Date().toISOString(), revision };
    return { key, revision };
  }
  if (op.kind === 'setGoalTemplate') {
    if (!payload || typeof payload.id !== 'string' || !TASK_ID.test(payload.id) || !validDate(payload.effectiveFrom) || payload.effectiveFrom < START_DATE) throw Error('INVALID_GOAL');
    validateGoalDate(op, payload.effectiveFrom);
    const latest = state.goalTemplates.at(-1);
    const key = 'goal-template';
    const base = resolveBase(state, op.baseRevision, key);
    if (base === null) throw Error('DEPENDENCY_MISSING');
    if (base !== (latest?.revision || 0)) return { conflict: latest || null };
    if (state.goalTemplates.some(item => item.id === payload.id)) throw Error('INVALID_GOAL');
    const tasks = validateTasks(payload.tasks, payload.mode, clientVersion);
    const revision = ++state.seq;
    state.goalTemplates.push({ id: payload.id, revision, effectiveFrom: payload.effectiveFrom, mode: payload.mode, tasks, createdAt: op.createdAt || new Date().toISOString() });
    return { key, revision };
  }
  if (op.kind === 'setGoalOverride') {
    if (!payload || !validDate(payload.date) || payload.date < START_DATE || !['custom', 'rest', 'default'].includes(payload.mode)) throw Error('INVALID_GOAL');
    validateGoalDate(op, payload.date);
    const key = `goal-override|${payload.date}`;
    const current = state.goalOverrides[payload.date];
    const base = resolveBase(state, op.baseRevision, key);
    if (base === null) throw Error('DEPENDENCY_MISSING');
    if (base !== (current?.revision || 0)) return { conflict: current || null };
    const tasks = payload.mode === 'custom' ? validateTasks(payload.tasks, payload.planMode, clientVersion) : [];
    const revision = ++state.seq;
    state.goalOverrides[payload.date] = { date: payload.date, mode: payload.mode, ...(payload.mode === 'custom' ? { planMode: payload.planMode } : {}), tasks, revision, updatedAt: new Date().toISOString() };
    return { key, revision };
  }
  throw Error('INVALID_PRACTICE_OP');
}
function applyPracticeOps(state, request) {
  ensurePracticeState(state);
  const practiceAck = [], practiceErrors = [];
  const ops = request.practiceOps || [];
  if (!Array.isArray(ops) || ops.length > 100) throw Error('TOO_MANY_PRACTICE_OPS');
  for (const op of ops) {
    if (!op || !OP_ID.test(op.id || '')) { practiceErrors.push({ id: op?.id, error: 'INVALID_PRACTICE_OP' }); continue; }
    if (op.epoch !== state.epoch) { practiceErrors.push({ id: op.id, error: 'STALE_EPOCH' }); continue; }
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(op)).digest('hex');
    const receipt = state.practiceReceipts[op.id];
    if (state.receipts?.[op.id]) { practiceErrors.push({ id: op.id, error: 'OP_ID_REUSED' }); continue; }
    if (receipt) {
      if (receipt.fingerprint === fingerprint) practiceAck.push(op.id);
      else practiceErrors.push({ id: op.id, error: 'OP_ID_REUSED' });
      continue;
    }
    try {
      const result = applyOne(state, op, request.clientVersion);
      if (Object.hasOwn(result, 'conflict')) { practiceErrors.push({ id: op.id, error: 'PRACTICE_CONFLICT', current: result.conflict }); continue; }
      state.practiceReceipts[op.id] = { fingerprint, key: result.key, revision: result.revision };
      practiceAck.push(op.id);
    } catch (error) {
      practiceErrors.push({ id: op.id, error: error.message });
    }
  }
  return { practiceAck, practiceErrors };
}
function validateGoalDate(op, date) {
  if (op.goalProtocol === undefined) {
    if (date < beijingDate(Date.now())) throw Error(op.kind === 'setGoalTemplate' ? 'PAST_GOAL_DATE' : 'INVALID_GOAL');
    return;
  }
  if (op.goalProtocol !== 2) throw Error('GOAL_PROTOCOL_UNSUPPORTED');
  const created = new Date(op.createdAt);
  if (typeof op.createdAt !== 'string' || !Number.isFinite(created.valueOf()) || created.toISOString() !== op.createdAt || created.valueOf() > Date.now() + 5 * 60000) throw Error('INVALID_GOAL_TIME');
  if (beijingDate(created) < START_DATE || date < beijingDate(created)) throw Error('INVALID_GOAL_TIME');
}
function restorePractice(source, next, confirmed = false) {
  ensurePracticeState(next);
  if (!source || typeof source !== 'object' || !Array.isArray(source.dailyCompletions) || !Array.isArray(source.goalTemplates) || !Array.isArray(source.goalOverrides)) throw Error('INVALID_PRACTICE_BACKUP');
  if (source.dailyCompletions.length > 100000 || source.goalTemplates.length > 2000 || source.goalOverrides.length > 20000) throw Error('INVALID_PRACTICE_BACKUP');
  if (source.pendingPracticeOperations?.length) throw Error('INVALID_PRACTICE_BACKUP');
  const goals = [...source.goalTemplates];
  const versions = new Set();
  for (const item of goals) {
    const version = confirmed ? item?.restoreOrder : item?.revision;
    if (!Number.isSafeInteger(version) || version <= 0 || versions.has(version)) throw Error('INVALID_PRACTICE_BACKUP');
    versions.add(version);
  }
  goals.sort((a,b) => confirmed ? a.restoreOrder-b.restoreOrder : a.revision-b.revision);
  const used = new Set();
  for (const item of source.dailyCompletions) {
    if (!item || !validDate(item.date) || item.date < START_DATE || item.date > beijingDate(Date.now()) || typeof item.questionId !== 'string' || item.questionId.length > 200 || !QUESTION_ID.test(item.questionId) || typeof item.completed !== 'boolean' || typeof item.occurredAt !== 'string' || beijingDate(item.occurredAt) !== item.date || new Date(item.occurredAt).toISOString() !== item.occurredAt || new Date(item.occurredAt).valueOf() > Date.now() + 5 * 60000 || typeof item.bankVersion !== 'string' || !item.bankVersion || item.bankVersion.length > 200) throw Error('INVALID_PRACTICE_BACKUP');
    const key = completionKey(item.date, item.questionId);
    if (used.has(key)) throw Error('INVALID_PRACTICE_BACKUP');
    used.add(key);
    const q = questionById.get(item.questionId);
    if (item.bankId !== (q ? bankIdOf(q) : bankIdForQuestionId(item.questionId)) || !Array.isArray(item.categoryIdsSnapshot) || item.categoryIdsSnapshot.length > 50 || item.categoryIdsSnapshot.some(id => !['string', 'number'].includes(typeof id) || String(id).length > 100)) throw Error('INVALID_PRACTICE_BACKUP');
    next.dailyCompletions[key] = { date: item.date, questionId: item.questionId, bankId: item.bankId, completed: item.completed, occurredAt: item.occurredAt, receivedAt: new Date().toISOString(), categoryIdsSnapshot: item.categoryIdsSnapshot.map(String), bankVersion: item.bankVersion, revision: ++next.seq };
  }
  const ids = new Set();
  for (const item of goals) {
    if (!item || !TASK_ID.test(item.id || '') || ids.has(item.id) || !validDate(item.effectiveFrom) || item.effectiveFrom < START_DATE || !['simple', 'scoped'].includes(item.mode) || !Array.isArray(item.tasks)) throw Error('INVALID_PRACTICE_BACKUP');
    ids.add(item.id);
    next.goalTemplates.push({ id: item.id, effectiveFrom: item.effectiveFrom, mode: item.mode, tasks: validateBackupTasks(item.tasks, item.mode), createdAt: item.createdAt || new Date().toISOString(), revision: ++next.seq });
  }
  for (const item of source.goalOverrides) {
    if (!item || !validDate(item.date) || item.date < START_DATE || next.goalOverrides[item.date] || !['custom', 'rest', 'default'].includes(item.mode) || (item.mode === 'custom' && !['simple', 'scoped'].includes(item.planMode))) throw Error('INVALID_PRACTICE_BACKUP');
    next.goalOverrides[item.date] = { date: item.date, mode: item.mode, ...(item.mode === 'custom' ? { planMode: item.planMode } : {}), tasks: item.mode === 'custom' ? validateBackupTasks(item.tasks, item.planMode) : [], updatedAt: item.updatedAt || new Date().toISOString(), revision: ++next.seq };
  }
}
function validateBackupTasks(tasks, mode) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 30) throw Error('INVALID_PRACTICE_BACKUP');
  if (mode === 'simple' && tasks.length !== 1) throw Error('INVALID_PRACTICE_BACKUP');
  const used = new Set(), taskIds = new Set(), output = [];
  for (const task of tasks) {
    if (!task || !TASK_ID.test(task.taskId || '') || taskIds.has(task.taskId) || !['all', 'exam', 'lilin880', 'yanxuan'].includes(task.bankId) || mode === 'simple' && task.bankId !== 'all' || mode === 'scoped' && task.bankId === 'all' || !Array.isArray(task.categoryIds) || task.categoryIds.length > 50 || task.categoryIds.some(x => !['string', 'number'].includes(typeof x)) || mode === 'simple' && task.categoryIds.length !== 0 || mode === 'scoped' && task.categoryIds.length === 0 || !Array.isArray(task.scopeQuestionIds) || task.scopeQuestionIds.length > 10000 || !Number.isInteger(task.targetCount) || task.targetCount < 1 || task.targetCount > 999 || task.targetCount > task.scopeQuestionIds.length || typeof task.bankVersion !== 'string' || !task.bankVersion || task.bankVersion.length > 200 || !Array.isArray(task.scopeLabels) || task.scopeLabels.length > 50 || task.scopeLabels.some(x => typeof x !== 'string' || x.length > 200)) throw Error('INVALID_PRACTICE_BACKUP');
    taskIds.add(task.taskId);
    if (!task.scopeQuestionIds.every(id => typeof id === 'string' && id.length <= 200 && QUESTION_ID.test(id) && (task.bankId === 'all' || bankIdForQuestionId(id) === task.bankId) && !used.has(id))) throw Error('INVALID_PRACTICE_BACKUP');
    for (const id of task.scopeQuestionIds) used.add(id);
    output.push({ taskId: task.taskId, bankId: task.bankId, categoryIds: task.categoryIds.map(String), targetCount: task.targetCount, scopeQuestionIds: [...task.scopeQuestionIds], bankVersion: task.bankVersion, scopeLabels: [...task.scopeLabels] });
  }
  return output;
}

module.exports = { bankIdForQuestionId, BANK_VERSION, START_DATE, QUESTION_ID, ensurePracticeState, snapshot, applyPracticeOps, restorePractice, beijingDate, idsForScope };
