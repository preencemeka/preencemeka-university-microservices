const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = Number.parseInt(process.env.PORT || '8080', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const serviceTargets = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:4001',
  students: process.env.STUDENT_SERVICE_URL || 'http://localhost:4002',
  courses: process.env.COURSE_SERVICE_URL || 'http://localhost:4003',
  grades: process.env.GRADES_SERVICE_URL || 'http://localhost:4004',
};
const publicCourseMethods = new Set(['GET', 'HEAD']);

app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((value) => value.trim()),
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.use('/api', async (req, res) => {
  const routeKey = resolveRouteKey(req.path);

  if (!routeKey) {
    return res.status(404).json({ error: 'Route not found' });
  }

  if (!isPublicRequest(req)) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!token) {
      return res.status(401).json({ error: 'Authentication token is required' });
    }

    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (_error) {
      return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }
  }

  try {
    const targetUrl = new URL(req.originalUrl.replace(/^\/api/, ''), serviceTargets[routeKey]);
    const headers = {
      accept: 'application/json',
    };

    if (req.headers.authorization) {
      headers.authorization = req.headers.authorization;
    }

    if (req.user) {
      headers['x-gateway-user-id'] = req.user.sub;
      headers['x-gateway-user-role'] = req.user.role;
      headers['x-gateway-user-email'] = req.user.email;
    }

    const fetchOptions = {
      method: req.method,
      headers,
    };

    if (!['GET', 'HEAD'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
      headers['content-type'] = 'application/json';
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    return res.status(response.status).send(payload);
  } catch (error) {
    return res.status(502).json({
      error: 'Failed to reach downstream service',
      details: error.message,
    });
  }
});

function resolveRouteKey(pathname) {
  if (pathname.startsWith('/auth')) return 'auth';
  if (pathname.startsWith('/students')) return 'students';
  if (pathname.startsWith('/courses')) return 'courses';
  if (pathname.startsWith('/grades')) return 'grades';
  return null;
}

function isPublicRequest(req) {
  if (req.path === '/health') return true;
  if (req.path.startsWith('/auth')) return true;
  if (req.path.startsWith('/courses') && publicCourseMethods.has(req.method)) return true;
  return false;
}

app.listen(PORT, () => {
  console.log(`API gateway listening on port ${PORT}`);
});
