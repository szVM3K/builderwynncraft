-- D1 (SQLite) schema of the site's small API. Safe to run again: every statement is IF NOT EXISTS.

-- Player submissions: builds for the Build Library and ability trees for the guide tree list.
-- status: pending (waiting for review) | approved (published) | rejected
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('build', 'tree')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  name TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  player_class TEXT NOT NULL DEFAULT '',
  archetype TEXT NOT NULL DEFAULT '',
  level INTEGER,
  main_skill TEXT NOT NULL DEFAULT '',
  ap INTEGER,
  code TEXT NOT NULL,
  settings TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  submitter TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS submissions_by_status ON submissions (kind, status, created_at);
CREATE INDEX IF NOT EXISTS submissions_by_submitter ON submissions (submitter, created_at);

-- Daily counters: event = generated | recommended | optimized | created | published | wb_export | wb_import | shared
-- | visitor; dim = '' (total) or 'class:Mage', 'arch:Riftwalker', 'lvl:100-106', 'skill:Meteor', 'mode:creator'.
CREATE TABLE IF NOT EXISTS counters (
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  dim TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, event, dim)
);

-- Who is on the site: an anonymous visitor id = hash(salt of the day + IP + browser), the salt changes every day
-- and old ones are deleted, so a visitor can't be followed from one day to the next and no IP is stored.
CREATE TABLE IF NOT EXISTS presence (
  visitor TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  mode TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS presence_by_seen ON presence (last_seen);

CREATE TABLE IF NOT EXISTS salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);

-- Failed sign-ins per visitor id (lock after 5 in 15 minutes).
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
