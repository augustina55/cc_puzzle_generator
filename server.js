require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@libsql/client');
const { Chess } = require('chess.js');

const app = express();
app.use(cors());
app.use(express.static('public'));

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/* -------------------------------------------------
   APPLY FIRST MOVE → FIX FEN → DROP FIRST MOVE
-------------------------------------------------- */
function applyFirstMoveAndFixFen(fen, movesStr) {
  const chess = new Chess(fen);
  const moves = movesStr.trim().split(' ');

  if (moves.length === 0) {
    return { fen, remainingMoves: '' };
  }

  const first = moves[0];

  const applied = chess.move({
    from: first.slice(0, 2),
    to: first.slice(2, 4),
    promotion: first[4]
  });

  if (!applied) {
    return { fen, remainingMoves: '' };
  }

  // Reset move counters → PGN must start from 1
  const parts = chess.fen().split(' ');
  parts[4] = '0'; // halfmove
  parts[5] = '1'; // fullmove

  return {
    fen: parts.join(' '),
    remainingMoves: moves.slice(1).join(' ')
  };
}

/* -------------------------------------------------
   CONVERT REMAINING MOVES → SAN WITH MOVE NUMBERS
-------------------------------------------------- */
function convertMovesToSANWithNumbers(fen, movesStr) {
  if (!movesStr) return '';

  const chess = new Chess(fen);
  const uciMoves = movesStr.trim().split(/\s+/);

  let output = [];
  let moveNumber = 1;

  for (let i = 0; i < uciMoves.length; i++) {
    const uci = uciMoves[i];

    const move = chess.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined
    });

    if (!move) break;

    if (move.color === 'w') {
      output.push(`${moveNumber}. ${move.san}`);
    } else if (move.color === 'b' && output.length === 0) {
      output.push(`${moveNumber}... ${move.san}`);
    } else {
      output[output.length - 1] += ` ${move.san}`;
      moveNumber++;
    }

    if (move.color === 'w' && chess.turn() === 'b' && i === uciMoves.length - 1) {
      moveNumber++;
    }
  }

  return output.join(' ');
}

function sideToPlayComment(fen) {
  const turn = fen.split(' ')[1];
  return turn === 'w' ? '{White to play}' : '{Black to play}';
}

/* -------------------------------------------------
   FILTER API
-------------------------------------------------- */
app.get('/api/filters', async (req, res) => {
  try {
    const themesResult = await db.execute({
      sql: `SELECT DISTINCT TRIM(value) AS theme
            FROM puzzles, json_each('["' || replace(Themes, ' ', '","') || '"]')
            WHERE Themes != ''
            ORDER BY theme`,
      args: []
    });

    const openingsResult = await db.execute({
      sql: `SELECT DISTINCT OpeningTags FROM puzzles WHERE OpeningTags != '' ORDER BY OpeningTags`,
      args: []
    });

    res.json({
      themes: themesResult.rows.map(r => r.theme),
      openings: openingsResult.rows.map(r => r.OpeningTags)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------
   PGN GENERATOR
-------------------------------------------------- */
app.get('/api/pgn', async (req, res) => {
  try {
    const {
      themes = '[]',
      openings = '',
      minRating = 800,
      maxRating = 2500,
      count = 50
    } = req.query;

    const themeList = JSON.parse(themes);
    const where = [];
    const args = [];

    if (themeList.length) {
      where.push(`(${themeList.map(() => 'Themes LIKE ?').join(' OR ')})`);
      themeList.forEach(t => args.push(`%${t}%`));
    }

    if (openings) {
      where.push('OpeningTags LIKE ?');
      args.push(`%${openings}%`);
    }

    where.push('Rating BETWEEN ? AND ?');
    args.push(+minRating, +maxRating);

    const sql = `
      SELECT * FROM puzzles
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY RANDOM()
      LIMIT ?
    `;

    args.push(+count);

    const result = await db.execute({ sql, args });
    const puzzles = result.rows;

    let pgn = '';

    puzzles.forEach((row, i) => {
      const mainTheme = row.Themes?.split(' ')[0] || 'Puzzle';

      const { fen: fixedFen, remainingMoves } =
        applyFirstMoveAndFixFen(row.FEN, row.Moves);

      if (!remainingMoves) return;

      const sanMoves = convertMovesToSANWithNumbers(fixedFen, remainingMoves);

      pgn += `[Event "Puzzle ${i + 1}"]\n`;
      pgn += `[Date "????.??.??"]\n`;
      pgn += `[White "Easy Exercises"]\n`;
      pgn += `[Black "Exercise ${i + 1}"]\n`;
      pgn += `[Result "*"]\n`;
      pgn += `[Variant "Standard"]\n`;
      pgn += `[puzzleId "${row.PuzzleId}"]\n`;
      pgn += `[Opening "${row.OpeningTags || '?'}"]\n`;
      pgn += `[StudyName "Custom PGN"]\n`;
      pgn += `[ChapterName "${mainTheme} Exercise ${i + 1}"]\n`;
      pgn += `[ChapterURL "${row.GameUrl || ''}"]\n`;
      pgn += `[Annotator "CircleChess"]\n`;
      pgn += `[FEN "${fixedFen}"]\n\n`;
      pgn += sideToPlayComment(fixedFen) + '\n';
      pgn += sanMoves + '\n\n';
    });

    res.type('text/plain').send(pgn);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* -------------------------------------------------
   SERVER
-------------------------------------------------- */
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`✅ Server running → http://localhost:${PORT}`)
  );
}

module.exports = app;
