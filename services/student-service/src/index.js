const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '4002', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL });

app.use(cors());
app.use(express.json());
app.use(createRateLimiter({ max: 250 }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'student-service' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', error: error.message });
  }
});

app.use(authenticate);

app.get('/students/me/profile', async (req, res) => {
  try {
    await ensureProfile(req.user);
    const result = await pool.query(
      `SELECT user_id, email, full_name, department, level, created_at, updated_at
       FROM student_profiles
       WHERE user_id = $1`,
      [req.user.sub],
    );
    return res.json(mapProfile(result.rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load profile', details: error.message });
  }
});

app.put('/students/me/profile', async (req, res) => {
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim() : req.user.fullName;
  const department = typeof req.body?.department === 'string' ? req.body.department.trim() : '';
  const level = typeof req.body?.level === 'string' ? req.body.level.trim() : '';

  if (!fullName) {
    return res.status(400).json({ error: 'fullName is required' });
  }

  try {
    await ensureProfile(req.user);
    const result = await pool.query(
      `UPDATE student_profiles
       SET full_name = $2, department = $3, level = $4, updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, email, full_name, department, level, created_at, updated_at`,
      [req.user.sub, fullName, department, level],
    );
    return res.json(mapProfile(result.rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update profile', details: error.message });
  }
});

app.get('/students/me/enrollments', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, user_id, course_id, status, created_at
       FROM enrollments
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.sub],
    );
    return res.json(result.rows.map(mapEnrollment));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load enrollments', details: error.message });
  }
});

app.post('/students/me/enrollments', async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can create enrollments' });
  }

  const courseId = typeof req.body?.courseId === 'string' ? req.body.courseId.trim() : '';
  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO enrollments (user_id, course_id)
       VALUES ($1, $2)
       RETURNING id, user_id, course_id, status, created_at`,
      [req.user.sub, courseId],
    );
    return res.status(201).json(mapEnrollment(result.rows[0]));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You are already enrolled in this course' });
    }

    return res.status(500).json({ error: 'Failed to create enrollment', details: error.message });
  }
});

start();

async function start() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Student service listening on port ${PORT}`);
  });
}

async function initializeDatabase() {
  await withRetry(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_profiles (
        user_id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        full_name TEXT NOT NULL,
        department TEXT NOT NULL DEFAULT '',
        level TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        course_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'enrolled',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, course_id)
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

async function ensureProfile(user) {
  await pool.query(
    `INSERT INTO student_profiles (user_id, email, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.sub, user.email, user.fullName || user.email],
  );
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

function mapProfile(row) {
  return {
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    department: row.department,
    level: row.level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEnrollment(row) {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

function createRateLimiter({ max }) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
    message: { error: 'Too many requests, please try again later.' },
  });
}
