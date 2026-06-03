const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'puzzles.db');
const db = new Database(dbPath);

// auto-detect table
const table = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table'")
  .get().name;

const rows = db
  .prepare(`SELECT * FROM ${table} LIMIT 5`)
  .all();

console.log(rows);

db.close();