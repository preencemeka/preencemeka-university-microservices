const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const crypto = require('node:crypto');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '4003', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({ connectionString: DATABASE_URL });
const seedCourses = [
  {
    id: crypto.randomUUID(),
    code: 'CSC101',
    title: 'Introduction to Computing',
    description: 'Foundational concepts in computer science and digital literacy.',
    credits: 3,
    lecturerName: 'Dr. Ada Okafor',
  },
  {
    id: crypto.randomUUID(),
    code: 'MTH201',
    title: 'Discrete Mathematics',
    description: 'Logic, sets, graphs, and mathematical reasoning for computing.',
    credits: 3,
    lecturerName: 'Prof. Chinedu Eze',
  },
  {
    id: crypto.randomUUID(),
    code: 'BUS110',
    title: 'Academic Writing and Communication',
    description: 'Writing, presentation, and communication skills for university study.',
    credits: 2,
    lecturerName: 'Mrs. Amaka Obi',
  },
];

app.use(cors());
app.use(express.json());
app.use(createRateLimiter({ max: 300 }));
app.use(attachUser);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'course-service' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', error: error.message });
  }
});

app.get('/courses', async (req, res) => {
  const search = typeof req.query.search === 'string' ? `%${req.query.search.trim().toLowerCase()}%` : null;

  try {
    const result = search
      ? await pool.query(
        `SELECT id, code, title, description, credits, lecturer_name, created_at, updated_at
         FROM courses
         WHERE LOWER(code) LIKE $1 OR LOWER(title) LIKE $1 OR LOWER(description) LIKE $1
         ORDER BY code`,
        [search],
      )
      : await pool.query(
        `SELECT id, code, title, description, credits, lecturer_name, created_at, updated_at
         FROM courses
         ORDER BY code`,
      );

    return res.json(result.rows.map(mapCourse));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load courses', details: error.message });
  }
});

app.get('/courses/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, code, title, description, credits, lecturer_name, created_at, updated_at
       FROM courses
       WHERE id = $1`,
      [req.params.id],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Course not found' });
    }

    return res.json(mapCourse(result.rows[0]));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load course', details: error.message });
  }
});

app.post('/courses', requireRoles('lecturer', 'admin'), async (req, res) => {
  const validationError = validateCourse(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const payload = normalizeCoursePayload(req.body);

  try {
    const result = await pool.query(
      `INSERT INTO courses (id, code, title, description, credits, lecturer_name)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, code, title, description, credits, lecturer_name, created_at, updated_at`,
      [crypto.randomUUID(), payload.code, payload.title, payload.description, payload.credits, payload.lecturerName],
    );
    return res.status(201).json(mapCourse(result.rows[0]));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A course with that code already exists' });
    }
    return res.status(500).json({ error: 'Failed to create course', details: error.message });
  }
});

app.put('/courses/:id', requireRoles('lecturer', 'admin'), async (req, res) => {
  const validationError = validateCourse(req.body);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const payload = normalizeCoursePayload(req.body);

  try {
    const result = await pool.query(
      `UPDATE courses
       SET code = $2, title = $3, description = $4, credits = $5, lecturer_name = $6, updated_at = NOW()
       WHERE id = $1
       RETURNING id, code, title, description, credits, lecturer_name, created_at, updated_at`,
      [req.params.id, payload.code, payload.title, payload.description, payload.credits, payload.lecturerName],
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Course not found' });
    }

    return res.json(mapCourse(result.rows[0]));
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A course with that code already exists' });
    }
    return res.status(500).json({ error: 'Failed to update course', details: error.message });
  }
});

app.delete('/courses/:id', requireRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Course not found' });
    }
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete course', details: error.message });
  }
});

start();

async function start() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Course service listening on port ${PORT}`);
  });
}

async function initializeDatabase() {
  await withRetry(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        credits INTEGER NOT NULL,
        lecturer_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existing = await pool.query('SELECT COUNT(*)::INTEGER AS count FROM courses');
    if (existing.rows[0].count === 0) {
      for (const course of seedCourses) {
        await pool.query(
          `INSERT INTO courses (id, code, title, description, credits, lecturer_name)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [course.id, course.code, course.title, course.description, course.credits, course.lecturerName],
        );
      }
    }
  });
}

function attachUser(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (_error) {
      req.user = null;
    }
  }

  return next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication token is required' });
    }

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

function validateCourse(payload) {
  const code = typeof payload?.code === 'string' ? payload.code.trim() : '';
  const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
  const description = typeof payload?.description === 'string' ? payload.description.trim() : '';
  const credits = Number(payload?.credits);
  const lecturerName = typeof payload?.lecturerName === 'string' ? payload.lecturerName.trim() : '';

  if (!code || !title || !description || !lecturerName) {
    return 'code, title, description, and lecturerName are required';
  }

  if (!Number.isInteger(credits) || credits < 1 || credits > 12) {
    return 'credits must be an integer between 1 and 12';
  }

  return null;
}

function normalizeCoursePayload(payload) {
  return {
    code: payload.code.trim().toUpperCase(),
    title: payload.title.trim(),
    description: payload.description.trim(),
    credits: Number(payload.credits),
    lecturerName: payload.lecturerName.trim(),
  };
}

function mapCourse(row) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    credits: row.credits,
    lecturerName: row.lecturer_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
