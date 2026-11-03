-- High-frequency collections are stored per record, with indexed ownership.
-- Legacy documents remain intact as the original import snapshot.
CREATE OR REPLACE FUNCTION app_normalize_phone(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE digits text := regexp_replace(coalesce(input,''),'[^0-9]','','g');
BEGIN
 IF left(digits,2)='55' AND length(digits)>=12 THEN digits:=substr(digits,3); END IF;
 IF length(digits)=10 AND digits ~ '^[1-9]{2}[6-9]' THEN digits:=left(digits,2)||'9'||substr(digits,3); END IF;
 RETURN digits;
END $$;
CREATE TABLE IF NOT EXISTS app_records (
 collection text NOT NULL CHECK(collection IN ('leads.json','conversations.json','pending-responses.json','followups.json')),
 record_key text NOT NULL,
 payload jsonb NOT NULL,
 client_id text GENERATED ALWAYS AS (coalesce(nullif(payload->>'clientId',''),CASE WHEN collection='conversations.json' AND strpos(record_key,':')>0 THEN split_part(record_key,':',1) END)) STORED,
 connection_id text GENERATED ALWAYS AS (coalesce(nullif(payload->>'connId',''),CASE WHEN collection='conversations.json' AND record_key ~ '^[^:]+:[^:]+:' THEN regexp_replace(regexp_replace(record_key,'^[^:]+:',''),':[^:]+$','') END)) STORED,
 funnel_id text GENERATED ALWAYS AS (payload->>'funnelId') STORED,
 phone_norm text GENERATED ALWAYS AS (app_normalize_phone(coalesce(payload->>'phone',CASE WHEN collection='conversations.json' THEN regexp_replace(record_key,'^.*:','') END))) STORED,
 real_phone_norm text GENERATED ALWAYS AS (app_normalize_phone(payload->>'realPhone')) STORED,
 status text GENERATED ALWAYS AS (payload->>'status') STORED,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(collection,record_key)
);
CREATE INDEX IF NOT EXISTS app_records_client_phone ON app_records(collection,client_id,phone_norm);
CREATE INDEX IF NOT EXISTS app_records_client_real_phone ON app_records(collection,client_id,real_phone_norm) WHERE real_phone_norm<>'';
CREATE INDEX IF NOT EXISTS app_records_connection_status ON app_records(collection,client_id,connection_id,status);
CREATE INDEX IF NOT EXISTS app_records_followup_due ON app_records(collection,status,(payload->>'scheduledAt')) WHERE collection='followups.json';
CREATE INDEX IF NOT EXISTS app_records_response_due ON app_records(collection,status,(payload->>'respondAfter')) WHERE collection='pending-responses.json';
CREATE INDEX IF NOT EXISTS app_records_wamid ON app_records((payload->>'wamid')) WHERE collection='followups.json';
CREATE OR REPLACE FUNCTION import_legacy_records() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE inserted bigint:=0; part bigint;
BEGIN
 IF EXISTS(SELECT 1 FROM app_records LIMIT 1) THEN RAISE EXCEPTION 'Normalized destination is not empty'; END IF;
 IF EXISTS(SELECT d.name,item->>'id' FROM app_documents d CROSS JOIN LATERAL jsonb_array_elements(d.payload) item WHERE d.name IN ('leads.json','pending-responses.json','followups.json') GROUP BY d.name,item->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate legacy IDs'; END IF;
 -- Fail on malformed IDs instead of silently discarding historical records.
 IF EXISTS(SELECT 1 FROM app_documents d CROSS JOIN LATERAL jsonb_array_elements(d.payload) item WHERE d.name IN ('leads.json','pending-responses.json','followups.json') AND (jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR item->>'id'='')) THEN RAISE EXCEPTION 'Legacy record without ID'; END IF;
 INSERT INTO app_records(collection,record_key,payload)
 SELECT d.name,item->>'id',item FROM app_documents d CROSS JOIN LATERAL jsonb_array_elements(d.payload) item WHERE d.name IN ('leads.json','pending-responses.json','followups.json')
 ON CONFLICT(collection,record_key) DO NOTHING;
 GET DIAGNOSTICS part=ROW_COUNT; inserted:=inserted+part;
 INSERT INTO app_records(collection,record_key,payload)
 SELECT d.name,item.key,item.value FROM app_documents d CROSS JOIN LATERAL jsonb_each(d.payload) item WHERE d.name='conversations.json'
 ON CONFLICT(collection,record_key) DO NOTHING;
 GET DIAGNOSTICS part=ROW_COUNT; RETURN inserted+part;
END $$;
SELECT import_legacy_records();
