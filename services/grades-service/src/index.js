const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('node:crypto');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '4004', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL });

app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'grades-service' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', error: error.message });
  }
});

app.use(authenticate);

app.get('/grades', requireRoles('lecturer', 'admin'), async (req, res) => {
  const studentUserId = typeof req.query.studentUserId === 'string' ? req.query.studentUserId.trim() : null;

  try {
    const result = studentUserId
      ? await pool.query(
        `SELECT id, student_user_id, course_id, score, letter_grade, comments, graded_by, created_at, updated_at
         FROM grades
         WHERE student_user_id = $1
         ORDER BY updated_at DESC`,
        [studentUserId],
      )
      : await pool.query(
        `SELECT id, student_user_id, course_id, score, letter_grade, comments, graded_by, created_at, updated_at
         FROM grades
         ORDER BY updated_at DESC`,
      );

    return res.json(result.rows.map(mapGrade));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load grades', details: error.message });
  }
});

app.get('/grades/me', async (req, res) => {
  try {
    const targetUserId = req.user.role === 'student' ? req.user.sub : (typeof req.query.studentUserId === 'string' ? req.query.studentUserId.trim() : req.user.sub);
    const result = await pool.query(
      `SELECT id, student_user_id, course_id, score, letter_grade, comments, graded_by, created_at, updated_at
       FROM grades
       WHERE student_user_id = $1
       ORDER BY updated_at DESC`,
      [targetUserId],
    );

    return res.json(result.rows.map(mapGrade));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load grades', details: error.message });
  }
});

app.post('/grades', requireRoles('lecturer', 'admin'), async (req, res) => {
  const studentUserId = typeof req.body?.studentUserId === 'string' ? req.body.studentUserId.trim() : '';
  const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId.trim() : '';
  const comments = typeof req.body?.comments === 'string' ? req.body.comments.trim() : '';
  const numericScore = Number(req.body?.score);
  const letterGrade = typeof req.body?.letterGrade === 'string' && req.body.letterGrade.trim()
    ? req.body.letterGrade.trim().toUpperCase()
    : deriveLetterGrade(numericScore);

  if (!studentUserId || !courseId) {
    return res.status(400).json({ error: 'studentUserId and courseId are required' });
  }

  if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > 100) {
    return res.status(400).json({ error: 'score must be between 0 and 100' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO grades (id, student_user_id, course_id, score, letter_grade, comments, graded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (student_user_id, course_id)
       DO UPDATE SET score = EXCLUDED.score, letter_grade = EXCLUDED.letter_grade, comments = EXCLUDED.comments,
         graded_by = EXCLUDED.graded_by, updated_at = NOW()
       RETURNING id, student_user_id, course_id, score, letter_grade, comments, graded_by, created_at, updated_at`,
      [crypto.randomUUID(), studentUserId, courseId, numericScore, letterGrade, comments, req.user.sub],
    );
    return res.status(201).json(mapGrade(result.rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save grade', details: error.message });
  }
});

start();

async function start() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Grades service listening on port ${PORT}`);
  });
}

async function initializeDatabase() {
  await withRetry(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS grades (
        id TEXT PRIMARY KEY,
        student_user_id TEXT NOT NULL,
        course_id TEXT NOT NULL,
        score NUMERIC(5,2) NOT NULL,
        letter_grade TEXT NOT NULL,
        comments TEXT NOT NULL DEFAULT '',
        graded_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (student_user_id, course_id)
      )
    `);
  });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Authentication token is required' });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action' });
    }

    return next();
  };
}

async function withRetry(task, retries = 20, delayMs = 3000) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await task();
      return;
    } catch (error) {
      lastError = error;
      console.warn(`Retrying database connection (${attempt}/${retries})`, error.message);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

function deriveLetterGrade(score) {
  if (score >= 70) return 'A';
  if (score >= 60) return 'B';
  if (score >= 50) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

function mapGrade(row) {
  return {
    id: row.id,
    studentUserId: row.student_user_id,
    courseId: row.course_id,
    score: Number(row.score),
    letterGrade: row.letter_grade,
    comments: row.comments,
    gradedBy: row.graded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
