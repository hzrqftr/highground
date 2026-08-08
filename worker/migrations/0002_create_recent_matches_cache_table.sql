-- Migration number: 0002 	 2026-08-08T11:37:28.073Z

CREATE TABLE IF NOT EXISTS recent_matches_cache (
  account_id TEXT PRIMARY KEY,   -- same Steam32 keying convention as player_stats
  steamid TEXT NOT NULL,
  matches_json TEXT NOT NULL,    -- JSON array of the trimmed match objects, role included
  last_refreshed_at INTEGER NOT NULL
);
