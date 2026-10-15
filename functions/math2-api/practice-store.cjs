const crypto = require('node:crypto');
const practice = require('./practice.cjs');

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
const number = value => { if (!Number.isSafeInteger(value) || value < 0) throw Error('INVALID_CURSOR'); return value; };
const encoded = value => `convert_from(decode('${Buffer.from(JSON.stringify(value)).toString('base64')}','base64'),'UTF8')::jsonb`;
const rows = result => (result.Rows || []).map(row => JSON.parse(row));
const json = value => typeof value === 'string' ? JSON.parse(value) : value;

function bucketFor(op) {
  if (op?.kind === 'complete' || op?.kind === 'undo') {
    const date = op.payload?.date;
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : null;
  }
  if (op?.kind === 'setGoalTemplate' || op?.kind === 'setGoalOverride') return 'goals';
  return null;
}
async function readHeads(db) {
  const result = await db.executePGSql({ Sql: 'SELECT s.revision,s.data,p.revision,p.epoch,p.seq FROM math2_private.state s CROSS JOIN math2_private.practice_meta p WHERE s.id=1 AND p.id=1' });
  const row = rows(result)[0];
  if (!row) throw Error('PRACTICE_SCHEMA_MISSING');
  return { stateRevision: Number(row[0]), state: json(row[1]), practiceRevision: Number(row[2]), practiceEpoch: row[3], practiceSeq: Number(row[4]) };
}
async function readPractice(db, head, request = {}, full = false) {
  const ops = Array.isArray(request.practiceOps) ? request.practiceOps : [];
  const touched = new Set(ops.map(bucketFor).filter(Boolean));
  const cursor = Number.isSafeInteger(request.practiceCursor) && request.practiceCursor >= 0 ? request.practiceCursor : 0;
  const include = touched.size ? `bucket IN (${[...touched].map(literal).join(',')}) OR ` : '';
  const condition = full ? 'true' : `(${include}max_revision>${number(cursor)})`;
  const result = await db.executePGSql({ Sql: `SELECT bucket,max_revision,data FROM math2_private.practice_buckets WHERE epoch=${literal(head.practiceEpoch)} AND ${condition}` });
  const state = { epoch: head.practiceEpoch, seq: head.practiceSeq, dailyCompletions: {}, goalTemplates: [], goalOverrides: {}, practiceReceipts: {}, receipts: head.state.receipts || {} };
  const originalBuckets = new Map();
  for (const [bucket, maxRevision, raw] of rows(result)) {
    const data = json(raw);
    originalBuckets.set(bucket, { maxRevision: Number(maxRevision), data });
    if (bucket === 'goals') {
      state.goalTemplates = data.goalTemplates || [];
      state.goalOverrides = data.goalOverrides || {};
    } else Object.assign(state.dailyCompletions, data.dailyCompletions || {});
  }
  const receiptIds = new Set();
  for (const op of [...ops, ...(Array.isArray(request.ops) ? request.ops : [])]) {
    if (typeof op?.id === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(op.id)) receiptIds.add(op.id);
    if (typeof op?.baseRevision === 'string' && /^[A-Za-z0-9_-]{10,100}$/.test(op.baseRevision)) receiptIds.add(op.baseRevision);
  }
  if (receiptIds.size) {
    const receipts = await db.executePGSql({ Sql: `SELECT id,fingerprint,entity_key,result_revision FROM math2_private.practice_receipts WHERE epoch=${literal(head.practiceEpoch)} AND id IN (${[...receiptIds].map(literal).join(',')})` });
    for (const [id, fingerprint, key, revision] of rows(receipts)) state.practiceReceipts[id] = { fingerprint, key, revision: Number(revision) };
  }
  return { state, originalBuckets, touched, cursor };
}
function bucketData(state, bucket) {
  if (bucket === 'goals') return { goalTemplates: state.goalTemplates, goalOverrides: state.goalOverrides };
  return { dailyCompletions: Object.fromEntries(Object.entries(state.dailyCompletions).filter(([key]) => key.startsWith(`${bucket}-`))) };
}
function bucketRevision(data, fallback) {
  const items = [...Object.values(data.dailyCompletions || {}), ...(data.goalTemplates || []), ...Object.values(data.goalOverrides || {})];
  return Math.max(fallback || 0, ...items.map(item => Number(item.revision) || 0));
}
function writesFor(loaded, result) {
  const buckets = [];
  for (const bucket of loaded.touched) {
    const data = bucketData(result.state, bucket);
    const old = loaded.originalBuckets.get(bucket);
    if (JSON.stringify(data) !== JSON.stringify(old?.data || (bucket === 'goals' ? { goalTemplates: [], goalOverrides: {} } : { dailyCompletions: {} })))
      buckets.push({ bucket, data, maxRevision: bucketRevision(data, old?.maxRevision || 0) });
  }
  const receipts = Object.entries(result.state.practiceReceipts).filter(([id]) => !loaded.state.practiceReceipts[id]).map(([id, value]) => ({ id, ...value }));
  return { buckets, receipts };
}
async function savePractice(db, head, loaded, result) {
  const { buckets, receipts } = writesFor(loaded, result);
  if (!buckets.length && !receipts.length) return true;
  const clauses = [`changed AS (UPDATE math2_private.practice_meta SET seq=${number(result.state.seq)},revision=revision+1 WHERE id=1 AND epoch=${literal(head.practiceEpoch)} AND revision=${number(head.practiceRevision)} RETURNING id)`];
  for (let i = 0; i < buckets.length; i++) {
    const item = buckets[i];
    clauses.push(`bucket_${i} AS (INSERT INTO math2_private.practice_buckets(epoch,bucket,max_revision,data) SELECT ${literal(head.practiceEpoch)},${literal(item.bucket)},${number(item.maxRevision)},${encoded(item.data)} FROM changed ON CONFLICT(epoch,bucket) DO UPDATE SET max_revision=EXCLUDED.max_revision,data=EXCLUDED.data RETURNING bucket)`);
  }
  for (let i = 0; i < receipts.length; i++) {
    const item = receipts[i];
    clauses.push(`receipt_${i} AS (INSERT INTO math2_private.practice_receipts(epoch,id,fingerprint,entity_key,result_revision) SELECT ${literal(head.practiceEpoch)},${literal(item.id)},${literal(item.fingerprint)},${literal(item.key)},${number(item.revision)} FROM changed RETURNING id)`);
  }
  const sql = `WITH ${clauses.join(',')} SELECT id FROM changed`;
  const saved = await db.executePGSql({ Sql: sql });
  return rows(saved).length === 1;
}
async function stageRestore(db, oldHead, newEpoch, source, fullBackup, confirmed = false) {
  let restored;
  if (fullBackup) {
    restored = { epoch: newEpoch, seq: oldHead.practiceSeq + 1, dailyCompletions: {}, goalTemplates: [], goalOverrides: {}, practiceReceipts: {} };
    practice.restorePractice(source, restored, confirmed);
  } else {
    const loaded = await readPractice(db, oldHead, {}, true);
    restored = { ...loaded.state, epoch: newEpoch, seq: oldHead.practiceSeq + 1, practiceReceipts: {} };
  }
  const buckets = new Set(Object.keys(restored.dailyCompletions).map(key => key.slice(0, 7)));
  if (restored.goalTemplates.length || Object.keys(restored.goalOverrides).length) buckets.add('goals');
  for (const bucket of buckets) {
    const data = bucketData(restored, bucket), maxRevision = bucketRevision(data, 0);
    const sql = `INSERT INTO math2_private.practice_buckets(epoch,bucket,max_revision,data) VALUES(${literal(newEpoch)},${literal(bucket)},${number(maxRevision)},${encoded(data)}) ON CONFLICT(epoch,bucket) DO NOTHING RETURNING bucket`;
    const inserted = await db.executePGSql({ Sql: sql });
    if (rows(inserted).length !== 1) throw Error('RESTORE_STAGE_COLLISION');
  }
  return restored;
}

module.exports = { readHeads, readPractice, savePractice, stageRestore, literal, encoded, rows, bucketData, bucketFor };
