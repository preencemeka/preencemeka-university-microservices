# Preencemeka University Microservices MVP

A complete MVP monorepo for **Preencemeka University** built with **React**, **Node.js/Express**, **PostgreSQL**, and **Docker Compose**.

## Architecture

- `frontend` — React + Vite portal that talks only to the API gateway
- `services/api-gateway` — request routing, CORS, JWT verification for protected endpoints, health checks
- `services/auth-service` — user registration/login, bcrypt password hashing, JWT issuance, roles in PostgreSQL
- `services/student-service` — student profiles and enrollments
- `services/course-service` — course catalog and course CRUD
- `services/grades-service` — grade publishing and grade viewing
- `postgres` — single PostgreSQL instance that bootstraps separate databases for each service (`auth_db`, `student_db`, `course_db`, `grades_db`)

## Features included

### Authentication
- Register and login endpoints
- Bcrypt password hashing
- JWT tokens with `student`, `lecturer`, and `admin` roles
- Persistent user storage in PostgreSQL

### API Gateway
- `/api/*` routing to downstream services
- JWT protection for private routes
- Public auth routes and public course catalog reads
- CORS configuration through environment variables
- `/health` endpoint

### Student service
- Student profile read/update
- Enrollment creation and listing

### Course service
- Public course catalog
- Course create/update for lecturers and admins
- Course delete for admins
- Seed data for immediate MVP usability

### Grades service
- Lecturer/admin grade publishing
- Student grade viewing
- Lecturer/admin grade listing

### Frontend
- Register/login workflow
- Dashboard with profile management
- Course catalog
- Student enrollment
- Grade viewing
- Lecturer/admin forms for course creation and grade publishing

## Repository layout

```text
.
├── docker/postgres/init-multiple-dbs.sh
├── docker-compose.yml
├── frontend
│   ├── .env.example
│   ├── Dockerfile
│   └── src
├── services
│   ├── api-gateway
│   ├── auth-service
│   ├── course-service
│   ├── grades-service
│   └── student-service
└── .env.example
```

## Environment variables

### Root `.env.example`
- `POSTGRES_USER` — PostgreSQL username
- `POSTGRES_PASSWORD` — PostgreSQL password
- `JWT_SECRET` — shared JWT secret used by gateway and services
- `CORS_ORIGIN` — allowed frontend origin for the gateway
- `GATEWAY_PORT` — published gateway port
- `FRONTEND_PORT` — published frontend port

### Service env examples
Each service directory contains a `.env.example` with its required variables:
- `PORT`
- `DATABASE_URL` for database-backed services
- `JWT_SECRET` where authentication is required
- downstream service URLs for the gateway
- `VITE_API_BASE_URL` for the frontend

## Local development

### Docker Compose (recommended)

```bash
docker compose up --build
```

Once healthy:
- Frontend: `http://localhost:5173`
- API Gateway: `http://localhost:8080`
- Health: `http://localhost:8080/health`

The PostgreSQL container automatically creates the required service databases during first startup, and each service creates its own tables on boot.

### Workspace install/build

```bash
npm install
npm run build
npm run lint
```

## API endpoints

### Auth service (via gateway)
- `POST /api/auth/register`
- `POST /api/auth/login`

### Student service (via gateway)
- `GET /api/students/me/profile`
- `PUT /api/students/me/profile`
- `GET /api/students/me/enrollments`
- `POST /api/students/me/enrollments`

### Course service (via gateway)
- `GET /api/courses`
- `GET /api/courses/:id`
- `POST /api/courses`
- `PUT /api/courses/:id`
- `DELETE /api/courses/:id`

### Grades service (via gateway)
- `GET /api/grades/me`
- `GET /api/grades`
- `POST /api/grades`

## Example payloads

### Register
```json
{
  "fullName": "Jane Doe",
  "email": "jane@example.com",
  "password": "password123",
  "role": "student"
}
```

### Create course
```json
{
  "code": "CSC205",
  "title": "Software Engineering",
  "description": "Core software engineering concepts and teamwork.",
  "credits": 3,
  "lecturerName": "Dr. Ifeoma Nwosu"
}
```

### Publish grade
```json
{
  "studentUserId": "student-user-id",
  "courseId": "course-id",
  "score": 82,
  "comments": "Strong performance"
}
```

## Assumptions

- A single PostgreSQL container with multiple databases is sufficient for this MVP while preserving service-level data ownership.
- The shared JWT secret is intentionally centralized for the MVP so the gateway and services can validate the same tokens.
- The frontend uses the gateway exclusively and assumes the gateway is available at `http://localhost:8080/api` by default.
- Student enrollments and grades are linked by user and course identifiers without cross-service joins; the frontend resolves course labels from the catalog.

## Notes

- Health endpoints are available on every service at `/health`.
- The course catalog seeds sample courses automatically when the course database is empty.
- This MVP focuses on the required flows and validation/error responses without introducing extra infrastructure beyond the requested stack.
