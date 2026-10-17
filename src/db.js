const Database = require("better-sqlite3");
const fs = require("node:fs");
const path = require("node:path");

const dbFile = process.env.DB_FILE || "./data/competition.sqlite";
if (dbFile !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbFile)), { recursive: true });
const db = new Database(dbFile);
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'participant' CHECK(role IN ('admin','participant')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  specialty TEXT NOT NULL CHECK(specialty IN ('Правоведение','Логистика','Экономика','Программирование')),
  title TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','completed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(specialty, start_date)
);
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  group_name TEXT NOT NULL,
  specialty TEXT NOT NULL CHECK(specialty IN ('Правоведение','Логистика','Экономика','Программирование')),
  user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL CHECK(stage_number BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  stage_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','open','closed')),
  max_points INTEGER NOT NULL DEFAULT 100 CHECK(max_points BETWEEN 1 AND 10000),
  UNIQUE(competition_id, stage_number)
);
CREATE TABLE IF NOT EXISTS results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  points REAL NOT NULL CHECK(points >= 0),
  comment TEXT NOT NULL DEFAULT '',
  entered_by INTEGER NOT NULL REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(participant_id, stage_id)
);
CREATE TABLE IF NOT EXISTS qualification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL UNIQUE REFERENCES competitions(id) ON DELETE CASCADE,
  pass_count INTEGER NOT NULL CHECK(pass_count >= 1),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_participants_specialty ON participants(specialty);
CREATE INDEX IF NOT EXISTS idx_results_stage ON results(stage_id);
`);

module.exports = db;
