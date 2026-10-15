BEGIN;
CREATE SCHEMA IF NOT EXISTS math2_private;
REVOKE ALL ON SCHEMA math2_private FROM PUBLIC,anon,authenticated;
CREATE TABLE IF NOT EXISTS math2_private.state(id integer PRIMARY KEY CHECK(id=1), revision bigint NOT NULL DEFAULT 0,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS math2_private.restores(epoch text PRIMARY KEY,data jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE math2_private.state ENABLE ROW LEVEL SECURITY;
ALTER TABLE math2_private.restores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA math2_private FROM PUBLIC,anon,authenticated;
INSERT INTO math2_private.state(id,data) VALUES(1,convert_from(decode('__INITIAL_STATE__','base64'),'UTF8')::jsonb) ON CONFLICT(id) DO NOTHING;

-- Practice data is stored by month so every ordinary write stays bounded.
CREATE TABLE IF NOT EXISTS math2_private.practice_meta(id integer PRIMARY KEY CHECK(id=1),epoch text NOT NULL,seq bigint NOT NULL DEFAULT 0,revision bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS math2_private.practice_buckets(epoch text NOT NULL,bucket text NOT NULL,max_revision bigint NOT NULL DEFAULT 0,data jsonb NOT NULL,PRIMARY KEY(epoch,bucket));
CREATE INDEX IF NOT EXISTS practice_buckets_cursor ON math2_private.practice_buckets(epoch,max_revision);
CREATE TABLE IF NOT EXISTS math2_private.practice_receipts(epoch text NOT NULL,id text NOT NULL,fingerprint text NOT NULL,entity_key text NOT NULL,result_revision bigint NOT NULL,PRIMARY KEY(epoch,id));
CREATE TABLE IF NOT EXISTS math2_private.practice_restores(epoch text PRIMARY KEY,seq bigint NOT NULL,revision bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE math2_private.practice_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE math2_private.practice_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE math2_private.practice_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE math2_private.practice_restores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA math2_private FROM PUBLIC,anon,authenticated;

-- Running the migration again never replaces an active practice row.
INSERT INTO math2_private.practice_meta(id,epoch,seq)
SELECT 1,data->>'epoch',COALESCE((data->>'seq')::bigint,0) FROM math2_private.state WHERE id=1
ON CONFLICT(id) DO NOTHING;
INSERT INTO math2_private.practice_buckets(epoch,bucket,max_revision,data)
SELECT s.data->>'epoch',left(items.key,7),max(COALESCE((items.value->>'revision')::bigint,0)),jsonb_build_object('dailyCompletions',jsonb_object_agg(items.key,items.value))
FROM math2_private.state s CROSS JOIN LATERAL jsonb_each(COALESCE(s.data->'dailyCompletions','{}'::jsonb)) items
WHERE s.id=1 GROUP BY s.data->>'epoch',left(items.key,7)
ON CONFLICT(epoch,bucket) DO NOTHING;
INSERT INTO math2_private.practice_buckets(epoch,bucket,max_revision,data)
SELECT data->>'epoch','goals',COALESCE((data->>'seq')::bigint,0),jsonb_build_object('goalTemplates',COALESCE(data->'goalTemplates','[]'::jsonb),'goalOverrides',COALESCE(data->'goalOverrides','{}'::jsonb))
FROM math2_private.state WHERE id=1 AND (data ? 'goalTemplates' OR data ? 'goalOverrides')
ON CONFLICT(epoch,bucket) DO NOTHING;
INSERT INTO math2_private.practice_receipts(epoch,id,fingerprint,entity_key,result_revision)
SELECT s.data->>'epoch',items.key,items.value->>'fingerprint',items.value->>'key',COALESCE((items.value->>'revision')::bigint,0)
FROM math2_private.state s CROSS JOIN LATERAL jsonb_each(COALESCE(s.data->'practiceReceipts','{}'::jsonb)) items
WHERE s.id=1 ON CONFLICT(epoch,id) DO NOTHING;
UPDATE math2_private.state SET data=data-'dailyCompletions'-'goalTemplates'-'goalOverrides'-'practiceReceipts',revision=revision+1
WHERE id=1 AND (data ? 'dailyCompletions' OR data ? 'goalTemplates' OR data ? 'goalOverrides' OR data ? 'practiceReceipts')
AND EXISTS(SELECT 1 FROM math2_private.practice_meta p WHERE p.id=1 AND p.epoch=math2_private.state.data->>'epoch');

-- This function locks both heads. A failed preview check changes neither head.
CREATE OR REPLACE FUNCTION math2_private.atomic_restore(
 expected_state_revision bigint, expected_practice_revision bigint, expected_epoch text,
 next_epoch text, next_state jsonb, next_practice_seq bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=math2_private,pg_temp AS $$
DECLARE old_state math2_private.state%ROWTYPE; old_practice math2_private.practice_meta%ROWTYPE;
BEGIN
 SELECT * INTO old_state FROM math2_private.state WHERE id=1 FOR UPDATE;
 SELECT * INTO old_practice FROM math2_private.practice_meta WHERE id=1 FOR UPDATE;
 IF old_state.revision<>expected_state_revision OR old_practice.revision<>expected_practice_revision
    OR old_state.data->>'epoch'<>expected_epoch OR old_practice.epoch<>expected_epoch THEN RETURN false; END IF;
 INSERT INTO math2_private.restores(epoch,data) VALUES(expected_epoch,old_state.data) ON CONFLICT(epoch) DO NOTHING;
 INSERT INTO math2_private.practice_restores(epoch,seq,revision) VALUES(expected_epoch,old_practice.seq,old_practice.revision) ON CONFLICT(epoch) DO NOTHING;
 UPDATE math2_private.state SET data=next_state,revision=revision+1 WHERE id=1;
 UPDATE math2_private.practice_meta SET epoch=next_epoch,seq=next_practice_seq,revision=revision+1 WHERE id=1;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION math2_private.atomic_restore(bigint,bigint,text,text,jsonb,bigint) FROM PUBLIC,anon,authenticated;
COMMIT;
