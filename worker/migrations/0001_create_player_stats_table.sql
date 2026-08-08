-- Migration number: 0001 	 2026-08-08T05:05:25.444Z

CREATE TABLE IF NOT EXISTS player_stats (
  account_id TEXT PRIMARY KEY,       -- Steam32 id; OpenDota's whole API is keyed on this, and
                                      -- steamIdToAccountId() already derives it before every call
  steamid TEXT NOT NULL,             -- Steam64, kept for debugging/audit only
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  kills_sum REAL NOT NULL,           -- sum of per-match kills, deaths, assists (avg = sum / kda_n)
  deaths_sum REAL NOT NULL,
  assists_sum REAL NOT NULL,
  kda_n INTEGER NOT NULL,            -- match count backing the kills/deaths/assists averages
  preferred_role TEXT,               -- "Carry" / "Mid" / "Offlane" / "Support" -- nullable
  preferred_role_games INTEGER,      -- classified matches (of up to 20 sampled) backing the pick
  last_refreshed_at INTEGER NOT NULL -- unix seconds, matches the JWT's own iat/exp convention
);
