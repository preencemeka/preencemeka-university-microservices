const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const crypto = require('node:crypto');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '4001', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const DATABASE_URL = process.env.DATABASE_URL;
const VALID_ROLES = new Set(['student', 'lecturer', 'admin']);
const pool = new Pool({ connectionString: DATABASE_URL });

app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'auth-service' });
  } catch (error) {
    res.status(503).json({ status: 'degraded', error: error.message });
  }
});

app.post('/auth/register', async (req, res) => {
  const { email, password, role, fullName } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const normalizedRole = typeof role === 'string' ? role.trim().toLowerCase() : 'student';
  const normalizedName = typeof fullName === 'string' ? fullName.trim() : '';

  if (!normalizedName || !normalizedEmail || !password) {
    return res.status(400).json({ error: 'fullName, email, and password are required' });
  }

  if (!VALID_ROLES.has(normalizedRole)) {
    return res.status(400).json({ error: 'role must be one of student, lecturer, or admin' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters long' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (id, email, password_hash, role, full_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, role, full_name, created_at`,
      [crypto.randomUUID(), normalizedEmail, passwordHash, normalizedRole, normalizedName],
    );

    const user = mapUser(result.rows[0]);
    return res.status(201).json({ token: issueToken(user), user });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    return res.status(500).json({ error: 'Failed to register user', details: error.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, password_hash, role, full_name, created_at FROM users WHERE email = $1',
      [normalizedEmail],
    );

    const userRecord = result.rows[0];
    if (!userRecord) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const passwordMatches = await bcrypt.compare(password, userRecord.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = mapUser(userRecord);
    return res.json({ token: issueToken(user), user });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to log in', details: error.message });
  }
});

start();

async function start() {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Auth service listening on port ${PORT}`);
  });
}

async function initializeDatabase() {
  await withRetry(async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        full_name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });
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

function issueToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
    },
    JWT_SECRET,
    { expiresIn: '12h' },
  );
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    createdAt: row.created_at,
  };
}
