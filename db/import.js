const fs = require('fs');
const csv = require('csv-parser');
const Database = require('better-sqlite3');

const CSV_PATH = './data/lichess_db.csv';
const DB_PATH = './data/puzzles.db';

console.log('Creating database...');
const db = new Database(DB_PATH);

// Create table
db.exec(`
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

// Prepare single insert statement
const insert = db.prepare(`
  INSERT OR IGNORE INTO puzzles 
  (PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes, GameUrl, OpeningTags)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

console.log('Importing CSV...');
let count = 0;
const batchSize = 5000;  // Smaller batches for stability
let batch = [];

fs.createReadStream(CSV_PATH)
  .pipe(csv())
  .on('data', (row) => {
    const rowData = [
      row.PuzzleId || '',
      row.FEN || '',
      row.Moves || '',
      parseInt(row.Rating) || 0,
      parseInt(row.RatingDeviation) || 0,
      parseInt(row.Popularity) || 0,
      parseInt(row.NbPlays) || 0,
      row.Themes || '',
      row.GameUrl || '',
      row.OpeningTags || ''
    ];
    
    batch.push(rowData);
    
    // Insert batch when full
    if (batch.length >= batchSize) {
      try {
        batch.forEach(row => insert.run(row));  // Insert one by one in batch
        count += batch.length;
        console.log(`Imported ${count} puzzles...`);
        batch = [];
      } catch (error) {
        console.error('Batch insert error:', error.message);
      }
    }
  })
  .on('end', () => {
    // Insert remaining rows
    if (batch.length > 0) {
      try {
        batch.forEach(row => insert.run(row));
        count += batch.length;
        console.log(`Final batch: +${batch.length} puzzles`);
      } catch (error) {
        console.error('Final batch error:', error.message);
      }
    }
    console.log(`✅ Import complete: ${count} total puzzles`);
    
    // Create indexes for fast queries
    db.exec('CREATE INDEX IF NOT EXISTS idx_themes ON puzzles(Themes)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_openingtags ON puzzles(OpeningTags)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_rating ON puzzles(Rating)');
    
    console.log('✅ Indexes created for fast filtering');
    db.close();
  })
  .on('error', (error) => {
    console.error('Stream error:', error.message);
    db.close();
  });
