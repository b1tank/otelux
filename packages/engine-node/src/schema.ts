/**
 * SQLite schema for the OTelux durable store.
 *
 * Design goals (see docs/spec.md storage section):
 *  - Generalizable for OpenTelemetry: attribute bags are stored as JSON, not
 *    exploded into convention-specific columns. Only the handful of fields the
 *    UI filters/sorts on are promoted to indexed columns.
 *  - Query-efficient: hot paths (trace list, log window, metric explorer) hit
 *    covering indexes; per-trace rollups are materialized so the list view
 *    never aggregates the raw span table.
 *  - uint64 nanosecond timestamps live in INTEGER columns (SQLite integers are
 *    signed 64-bit, ample until year 2262) and are read back as BigInt.
 *
 * Resources and scopes are interned (deduplicated by content hash) so a busy
 * exporter that repeats the same resource on every export does not bloat the
 * per-row storage.
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS resources (
  id            INTEGER PRIMARY KEY,
  hash          TEXT    NOT NULL UNIQUE,
  service_name  TEXT    NOT NULL DEFAULT '',
  attributes    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS scopes (
  id            INTEGER PRIMARY KEY,
  hash          TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL DEFAULT '',
  version       TEXT,
  attributes    TEXT
);

CREATE TABLE IF NOT EXISTS spans (
  span_id             TEXT    PRIMARY KEY,
  trace_id            TEXT    NOT NULL,
  parent_span_id      TEXT,
  name                TEXT    NOT NULL,
  kind                INTEGER NOT NULL,
  start_unix_nano     INTEGER NOT NULL,
  end_unix_nano       INTEGER NOT NULL,
  status_code         INTEGER NOT NULL,
  status_message      TEXT,
  trace_state         TEXT,
  attributes          TEXT    NOT NULL,
  events              TEXT,
  links               TEXT,
  dropped_attributes  INTEGER,
  dropped_events      INTEGER,
  dropped_links       INTEGER,
  resource_id         INTEGER NOT NULL REFERENCES resources(id),
  scope_id            INTEGER NOT NULL REFERENCES scopes(id),
  service_name        TEXT    NOT NULL DEFAULT '',
  ingested_unix_nano  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spans_trace    ON spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_spans_start    ON spans(start_unix_nano);
CREATE INDEX IF NOT EXISTS idx_spans_ingested ON spans(ingested_unix_nano);

-- Materialized per-trace rollup. Recomputed for each affected trace on write
-- so listTraces reads one indexed table instead of aggregating spans.
CREATE TABLE IF NOT EXISTS traces (
  trace_id            TEXT    PRIMARY KEY,
  root_span_id        TEXT,
  root_name           TEXT    NOT NULL DEFAULT '',
  start_unix_nano     INTEGER NOT NULL,
  end_unix_nano       INTEGER NOT NULL,
  duration_nanos      INTEGER NOT NULL,
  span_count          INTEGER NOT NULL,
  error_count         INTEGER NOT NULL,
  services            TEXT    NOT NULL,
  ingested_unix_nano  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_traces_start    ON traces(start_unix_nano);
CREATE INDEX IF NOT EXISTS idx_traces_ingested ON traces(ingested_unix_nano);

CREATE TABLE IF NOT EXISTS logs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  time_unix_nano           INTEGER NOT NULL,
  observed_time_unix_nano  INTEGER,
  severity_number          INTEGER NOT NULL,
  severity_text            TEXT,
  event_name               TEXT,
  body                     TEXT,
  attributes               TEXT    NOT NULL,
  flags                    INTEGER,
  trace_id                 TEXT,
  span_id                  TEXT,
  dropped_attributes       INTEGER,
  resource_id              INTEGER NOT NULL REFERENCES resources(id),
  scope_id                 INTEGER NOT NULL REFERENCES scopes(id),
  service_name             TEXT    NOT NULL DEFAULT '',
  scope_name               TEXT    NOT NULL DEFAULT '',
  search_text              TEXT    NOT NULL,
  ingested_unix_nano       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_time     ON logs(time_unix_nano);
CREATE INDEX IF NOT EXISTS idx_logs_severity ON logs(severity_number);
CREATE INDEX IF NOT EXISTS idx_logs_trace    ON logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_logs_ingested ON logs(ingested_unix_nano);

-- One row per instrument identity (service|scope|name|type). Repeated exports
-- of the same instrument update this row and append points below.
CREATE TABLE IF NOT EXISTS metric_instruments (
  id                  INTEGER PRIMARY KEY,
  identity            TEXT    NOT NULL UNIQUE,
  service_name        TEXT    NOT NULL DEFAULT '',
  scope_name          TEXT    NOT NULL DEFAULT '',
  name                TEXT    NOT NULL,
  description         TEXT,
  unit                TEXT,
  type                TEXT    NOT NULL,
  is_monotonic        INTEGER,
  temporality         INTEGER,
  resource_id         INTEGER NOT NULL REFERENCES resources(id),
  scope_id            INTEGER NOT NULL REFERENCES scopes(id),
  updated_unix_nano   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_points (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument_id         INTEGER NOT NULL REFERENCES metric_instruments(id) ON DELETE CASCADE,
  time_unix_nano        INTEGER NOT NULL,
  start_time_unix_nano  INTEGER,
  flags                 INTEGER,
  attributes            TEXT    NOT NULL,
  value                 REAL,
  count                 INTEGER,
  sum                   REAL,
  min                   REAL,
  max                   REAL,
  bucket_counts         TEXT,
  explicit_bounds       TEXT,
  ingested_unix_nano    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_instrument ON metric_points(instrument_id, id);
CREATE INDEX IF NOT EXISTS idx_points_ingested   ON metric_points(ingested_unix_nano);
`;
