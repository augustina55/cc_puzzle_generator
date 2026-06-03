require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { createClient } = require('@libsql/client');
const path = require('path');

const LOCAL_DB_PATH = path.join(__dirname, '..', 'data', 'puzzles.db');
const BATCH_SIZE = 500;

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
    console.error('❌ Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env first');
    process.exit(1);
  }

  // @libsql/client can read local SQLite files directly
  const local = createClient({ url: `file:${LOCAL_DB_PATH}` });
  const turso = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // Create table in Turso
  console.log('Creating table in Turso...');
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS puzzles (
      PuzzleId TEXT PRIMARY KEY,
      FEN TEXT,
      Moves TEXT,
      Rating INTEGER,
      RatingDeviation INTEGER,
      Popularity INTEGER,
      NbPlays INTEGER,
      Themes TEXT,
      GameUrl TEXT,
      OpeningTags TEXT
    )
  `);

  const countResult = await local.execute('SELECT COUNT(*) as n FROM puzzles');
  const total = Number(countResult.rows[0].n);
  console.log(`Migrating ${total.toLocaleString()} puzzles in batches of ${BATCH_SIZE}...`);

  let offset = 0;
  let migrated = 0;

  while (true) {
    const result = await local.execute({
      sql: 'SELECT * FROM puzzles LIMIT ? OFFSET ?',
      args: [BATCH_SIZE, offset]
    });

    if (result.rows.length === 0) break;

    const statements = result.rows.map(r => ({
      sql: `INSERT OR IGNORE INTO puzzles
            (PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [r.PuzzleId, r.FEN, r.Moves, r.Rating, r.RatingDeviation,
             r.Popularity, r.NbPlays, r.Themes, r.GameUrl, r.OpeningTags]
    }));

    await turso.batch(statements, 'write');
    migrated += result.rows.length;
    offset += result.rows.length;

    const pct = ((migrated / total) * 100).toFixed(1);
    process.stdout.write(`\r  ${migrated.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`);
  }

  console.log('\nCreating indexes...');
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_themes ON puzzles(Themes)');
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_openingtags ON puzzles(OpeningTags)');
  await turso.execute('CREATE INDEX IF NOT EXISTS idx_rating ON puzzles(Rating)');

  console.log('✅ Migration complete!');
}

migrate().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
