const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const CloudBase = require('@cloudbase/manager-node');
const { apply } = require('./engine.cjs');
const practice = require('./practice.cjs');
const store = require('./practice-store.cjs');

function required(name) { const value = process.env[name]; if (!value?.trim()) throw Error('CONFIG_MISSING'); return value.trim(); }
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets-manifest.json'), 'utf8'));
const capabilities = { practice: 1, goalProtocol: 2, goalBankCompatibility: 1, backupRecovery: 1 };
const cap = { capabilities, practiceEnabledFrom: practice.START_DATE };

function manager() {
  return CloudBase.init({ envId: required('MATH2_ENV_ID'), region: process.env.MATH2_REGION || 'ap-shanghai', secretId: process.env.TENCENTCLOUD_SECRETID, secretKey: process.env.TENCENTCLOUD_SECRETKEY, token: process.env.TENCENTCLOUD_SESSIONTOKEN });
}
async function identity(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > 20000) throw Error('AUTH_REQUIRED');
  const UID = required('MATH2_ALLOWED_UID'), EMAIL = required('MATH2_ALLOWED_EMAIL').toLowerCase();
  const gateway = `https://${required('MATH2_ENV_ID')}.api.tcloudbasegateway.com`;
  const response = await fetch(gateway + '/auth/v1/user/me', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('AUTH_REQUIRED');
  const user = await response.json();
  if (String(user.sub || user.id || user.user_id) !== UID || user.email?.toLowerCase() !== EMAIL || user.status && user.status !== 'ACTIVE') throw Error('ACCESS_DENIED');
  return { id: UID, email: EMAIL };
}
function withoutPractice(state) {
  const next = structuredClone(state);
  for (const key of ['dailyCompletions', 'goalTemplates', 'goalOverrides', 'practiceReceipts']) delete next[key];
  return next;
}
function boundedPracticeRequest(event) {
  if (event.practiceOps === undefined) return { ...event, practiceOps: [] };
  if (!Array.isArray(event.practiceOps) || event.practiceOps.length > 100) throw Error('TOO_MANY_PRACTICE_OPS');
  const buckets = new Set(), selected = [];
  for (const op of event.practiceOps) {
    const bucket = store.bucketFor(op) || 'invalid';
    if (!buckets.has(bucket) && buckets.size >= 12) break;
    buckets.add(bucket);
    selected.push(op);
  }
  return { ...event, practiceOps: selected };
}
async function saveRecordState(db, head, next) {
  const sql = `UPDATE math2_private.state SET data=${store.encoded(next)},revision=revision+1 WHERE id=1 AND revision=${head.stateRevision} AND data->>'epoch'=${store.literal(head.state.epoch)} RETURNING revision`;
  return store.rows(await db.executePGSql({ Sql: sql })).length === 1;
}
function staleResponse(head, loaded, newClient) {
  return { ok: true, ...cap, epoch: head.state.epoch, seq: head.state.seq, stale: true, ack: [], records: Object.values(head.state.records), position: head.state.position, positions: head.state.positions || {}, ...(newClient ? practice.snapshot(loaded.state, 0, true) : {}) };
}
async function restore(db, head, event) {
  if (event.pendingPracticeOperations?.length) throw Error('INVALID_PRACTICE_BACKUP');
  if (event.recoveryVersion !== undefined && event.recoveryVersion !== 1) throw Error('UPGRADE_REQUIRED');
  if (event.recoveryVersion === 1 && (!/^[a-zA-Z0-9_-]{10,100}$/.test(event.restoreId || '') || event.expectedStateRevision !== head.stateRevision || event.expectedPracticeRevision !== head.practiceRevision)) throw Error('PREVIEW_CHANGED');
  if (event.expectedSeq !== head.state.seq || event.expectedPracticeCursor !== head.practiceSeq || event.epoch !== head.state.epoch) throw Error('PREVIEW_CHANGED');
  const old = apply(head.state, { ...event, practiceBackup: undefined, practiceOps: [] });
  const nextState = withoutPractice(old.state);
  if (event.recoveryVersion === 1) nextState.epoch = event.restoreId;
  const practiceState = await store.stageRestore(db, head, nextState.epoch, event.practiceBackup, !!event.practiceBackup, event.recoveryVersion === 1);
  const sql = `SELECT math2_private.atomic_restore(${head.stateRevision},${head.practiceRevision},${store.literal(head.state.epoch)},${store.literal(nextState.epoch)},${store.encoded(nextState)},${practiceState.seq})`;
  const switched = store.rows(await db.executePGSql({ Sql: sql }))[0]?.[0];
  if (switched !== true && switched !== 'true' && switched !== 't') throw Error('PREVIEW_CHANGED');
  return { ok: true, ...cap, ...old.response, epoch: nextState.epoch, seq: nextState.seq, restored: true, full: true, ...practice.snapshot(practiceState, 0, true) };
}

exports.main = async event => {
  try {
    if (event?.action === 'health') return { ok: true, ready: true, scope: 'function' };
    const user = await identity(event?.accessToken);
    const activeManifest = event.clientVersion === 3 ? manifest : JSON.parse(fs.readFileSync(path.join(__dirname, event.clientVersion === 2 ? 'v2-assets-manifest.json' : 'legacy-assets-manifest.json'), 'utf8'));
    if (event.action === 'identity') return { ok: true, user, ...cap };
    if (event.action === 'manifest') return { ok: true, manifest: activeManifest };
    if (event.action === 'asset') {
      const entry = activeManifest.files.find(file => file.path === event.path);
      if (!entry) throw Error('NOT_FOUND');
      const target = entry.path === 'data/bank.json' ? (event.clientVersion === 3 ? entry.path : event.clientVersion === 2 ? 'data/v2-bank.json' : 'data/legacy-bank.json') : entry.path;
      return { ok: true, path: entry.path, sha256: entry.sha256, data: fs.readFileSync(path.join(__dirname, 'assets', target)).toString('base64') };
    }
    if (event.action === 'assetBatch') {
      if (![2, 3].includes(event.clientVersion) || !Array.isArray(event.paths) || event.paths.length < 1 || event.paths.length > 16 || new Set(event.paths).size !== event.paths.length) throw Error('NOT_FOUND');
      const entries = event.paths.map(item => activeManifest.files.find(file => file.path === item));
      if (entries.some(item => !item) || entries.reduce((total, item) => total + item.bytes, 0) > 3000000) throw Error('NOT_FOUND');
      return { ok: true, files: entries.map(item => ({ path: item.path, data: fs.readFileSync(path.join(__dirname, 'assets', event.clientVersion === 2 && item.path === 'data/bank.json' ? 'data/v2-bank.json' : item.path)).toString('base64') })) };
    }
    if (!['sync', 'restore', 'preview'].includes(event.action)) throw Error('INVALID_ACTION');
    if (event.action === 'restore' && event.practiceVersion !== 1) throw Error('UPGRADE_REQUIRED');
    const practiceEvent = boundedPracticeRequest(event);
    const db = manager().database;
    for (let attempt = 0; attempt < 6; attempt++) {
      const head = await store.readHeads(db);
      if (head.state.epoch !== head.practiceEpoch) throw Error('PRACTICE_EPOCH_MISMATCH');
      if (event.action === 'restore') {
        if (event.recoveryVersion === 1 && head.state.epoch === event.restoreId) {
          const loaded = await store.readPractice(db, head, {}, true);
          return { ok: true, ...cap, full: true, restored: true, epoch: head.state.epoch, seq: head.state.seq, records: Object.values(head.state.records), position: head.state.position, positions: head.state.positions || {}, ...practice.snapshot(loaded.state, 0, true) };
        }
        return await restore(db, head, event);
      }
      const newClient = event.practiceVersion === 1;
      if (event.action === 'preview') {
        const loaded = newClient ? await store.readPractice(db, head, {}, true) : null;
        return { ok: true, ...cap, full: true, stateRevision: head.stateRevision, practiceRevision: head.practiceRevision, epoch: head.state.epoch, seq: head.state.seq, records: Object.values(head.state.records), position: head.state.position, positions: head.state.positions || {}, ...(newClient ? practice.snapshot(loaded.state, 0, true) : {}) };
      }
      if (event.epoch && event.epoch !== head.state.epoch) {
        const loaded = newClient ? await store.readPractice(db, head, {}, true) : null;
        return staleResponse(head, loaded, newClient);
      }
      if (!newClient && event.practiceOps?.length) throw Error('UPGRADE_REQUIRED');
      const loaded = await store.readPractice(db, head, { ...practiceEvent, practiceCursor: newClient ? event.practiceCursor : head.practiceSeq });
      const legacy = apply({ ...head.state, practiceReceipts: loaded.state.practiceReceipts }, { ...event, practiceVersion: undefined, practiceOps: [] });
      const nextState = withoutPractice(legacy.state);
      if (!isDeepStrictEqual(nextState, head.state)) {
        if (!await saveRecordState(db, head, nextState)) continue;
        head.state = nextState;
        head.stateRevision++;
      }
      if (!newClient) return { ok: true, ...cap, ...legacy.response };
      loaded.state.receipts = head.state.receipts || {};
      const nextPractice = structuredClone(loaded.state);
      const result = practice.applyPracticeOps(nextPractice, practiceEvent);
      const saved = await store.savePractice(db, head, loaded, { state: nextPractice });
      if (!saved) continue;
      return { ok: true, ...cap, ...legacy.response, ...result, ...practice.snapshot(nextPractice, loaded.cursor) };
    }
    throw Error('BUSY_RETRY');
  } catch (error) {
    const known = /^(AUTH_REQUIRED|ACCESS_DENIED|CONFIG_MISSING|NOT_FOUND|INVALID_ACTION|PREVIEW_CHANGED|INVALID_BACKUP|INVALID_RECORD|INVALID_FIELD|DUPLICATE_RECORD|TOO_MANY_OPS|TOO_MANY_PRACTICE_OPS|INVALID_PRACTICE_BACKUP|UPGRADE_REQUIRED|BUSY_RETRY)$/;
    if (!known.test(error.message) && !['PRACTICE_SCHEMA_MISSING', 'PRACTICE_EPOCH_MISMATCH'].includes(error.message)) console.error('backend_failure', { code: error.code || error.name, requestId: error.requestId });
    return { ok: false, error: known.test(error.message) ? error.message : ['PRACTICE_SCHEMA_MISSING', 'PRACTICE_EPOCH_MISMATCH'].includes(error.message) ? 'PRACTICE_UNAVAILABLE' : 'SERVICE_UNAVAILABLE' };
  }
};
