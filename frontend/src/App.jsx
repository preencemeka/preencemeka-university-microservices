import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080/api'
const TOKEN_STORAGE_KEY = 'preencemeka-university-token'
const USER_STORAGE_KEY = 'preencemeka-university-user'
const initialAuthMode = 'login'

const emptyProfile = {
  fullName: '',
  department: '',
  level: '',
}

const emptyCourseForm = {
  code: '',
  title: '',
  description: '',
  credits: 3,
  lecturerName: '',
}

const emptyGradeForm = {
  studentUserId: '',
  courseId: '',
  score: '',
  comments: '',
}

function App() {
  const [authMode, setAuthMode] = useState(initialAuthMode)
  const [token, setToken] = useState(localStorage.getItem(TOKEN_STORAGE_KEY) || '')
  const [user, setUser] = useState(readStoredUser())
  const [authForm, setAuthForm] = useState({ fullName: '', email: '', password: '', role: 'student' })
  const [profile, setProfile] = useState(emptyProfile)
  const [courses, setCourses] = useState([])
  const [enrollments, setEnrollments] = useState([])
  const [grades, setGrades] = useState([])
  const [courseForm, setCourseForm] = useState(emptyCourseForm)
  const [gradeForm, setGradeForm] = useState(emptyGradeForm)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const enrolledCourseIds = useMemo(() => new Set(enrollments.map((item) => item.courseId)), [enrollments])
  const canManageAcademics = user?.role === 'admin' || user?.role === 'lecturer'

  const loadCourses = useCallback(async () => {
    try {
      const nextCourses = await apiFetch('/courses')
      setCourses(nextCourses)
    } catch (fetchError) {
      setError(fetchError.message)
    }
  }, [])

  useEffect(() => {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  }, [token])

  useEffect(() => {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
    } else {
      localStorage.removeItem(USER_STORAGE_KEY)
    }
  }, [user])

  const loadDashboard = useCallback(async () => {
    setIsLoading(true)
    setError('')

    try {
      const [profileResponse, enrollmentResponse, gradeResponse, courseResponse] = await Promise.all([
        apiFetch('/students/me/profile', { token }),
        apiFetch('/students/me/enrollments', { token }),
        apiFetch(user?.role === 'student' ? '/grades/me' : '/grades', { token }),
        apiFetch('/courses', { token }),
      ])

      setProfile({
        fullName: profileResponse.fullName || '',
        department: profileResponse.department || '',
        level: profileResponse.level || '',
      })
      setEnrollments(enrollmentResponse)
      setGrades(gradeResponse)
      setCourses(courseResponse)
    } catch (fetchError) {
      setError(fetchError.message)
    } finally {
      setIsLoading(false)
    }
  }, [token, user?.role])

  useEffect(() => {
    loadCourses()
  }, [loadCourses])

  useEffect(() => {
    if (token && user) {
      loadDashboard()
    } else {
      setProfile(emptyProfile)
      setEnrollments([])
      setGrades([])
    }
  }, [loadDashboard, token, user])

  async function handleAuthSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setIsLoading(true)

    try {
      const endpoint = authMode === 'register' ? '/auth/register' : '/auth/login'
      const payload = authMode === 'register'
        ? authForm
        : { email: authForm.email, password: authForm.password }
      const response = await apiFetch(endpoint, {
        method: 'POST',
        body: payload,
      })

      setToken(response.token)
      setUser(response.user)
      setMessage(authMode === 'register' ? 'Account created successfully.' : 'Welcome back!')
      setAuthForm({ fullName: '', email: '', password: '', role: 'student' })
    } catch (fetchError) {
      setError(fetchError.message)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleProfileSave(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    try {
      const updatedProfile = await apiFetch('/students/me/profile', {
        method: 'PUT',
        token,
        body: profile,
      })
      setProfile({
        fullName: updatedProfile.fullName || '',
        department: updatedProfile.department || '',
        level: updatedProfile.level || '',
      })
      setUser((currentUser) => currentUser ? { ...currentUser, fullName: updatedProfile.fullName } : currentUser)
      setMessage('Profile updated successfully.')
    } catch (fetchError) {
      setError(fetchError.message)
    }
  }

  async function handleEnroll(courseId) {
    setError('')
    setMessage('')

    try {
      const enrollment = await apiFetch('/students/me/enrollments', {
        method: 'POST',
        token,
        body: { courseId },
      })
      setEnrollments((currentEnrollments) => [enrollment, ...currentEnrollments])
      setMessage('Enrollment created successfully.')
    } catch (fetchError) {
      setError(fetchError.message)
    }
  }

  async function handleCourseCreate(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    try {
      const createdCourse = await apiFetch('/courses', {
        method: 'POST',
        token,
        body: courseForm,
      })
      setCourses((currentCourses) => [...currentCourses, createdCourse].sort((left, right) => left.code.localeCompare(right.code)))
      setCourseForm(emptyCourseForm)
      setMessage('Course created successfully.')
    } catch (fetchError) {
      setError(fetchError.message)
    }
  }

  async function handleGradeSubmit(event) {
    event.preventDefault()
    setError('')
    setMessage('')

    try {
      const savedGrade = await apiFetch('/grades', {
        method: 'POST',
        token,
        body: {
          ...gradeForm,
          score: Number(gradeForm.score),
        },
      })
      setGrades((currentGrades) => {
        const filteredGrades = currentGrades.filter(
          (grade) => !(grade.studentUserId === savedGrade.studentUserId && grade.courseId === savedGrade.courseId),
        )
        return [savedGrade, ...filteredGrades]
      })
      setGradeForm(emptyGradeForm)
      setMessage('Grade recorded successfully.')
    } catch (fetchError) {
      setError(fetchError.message)
    }
  }

  function handleLogout() {
    setToken('')
    setUser(null)
    setMessage('You have been signed out.')
    setError('')
  }

  return (
    <main className="page-shell">
      <header className="hero-panel">
        <div>
          <p className="eyebrow">Preencemeka University</p>
          <h1>Microservices MVP portal</h1>
          <p className="subtle-text">
            React frontend, Node.js services, PostgreSQL persistence, and Docker Compose orchestration.
          </p>
        </div>
        {user ? (
          <button type="button" className="secondary-button" onClick={handleLogout}>
            Sign out
          </button>
        ) : null}
      </header>

      {message ? <p className="notice success">{message}</p> : null}
      {error ? <p className="notice error">{error}</p> : null}

      {!user ? (
        <section className="grid two-columns">
          <article className="card">
            <div className="segmented-control">
              <button
                type="button"
                className={authMode === 'login' ? 'active' : ''}
                onClick={() => setAuthMode('login')}
              >
                Login
              </button>
              <button
                type="button"
                className={authMode === 'register' ? 'active' : ''}
                onClick={() => setAuthMode('register')}
              >
                Register
              </button>
            </div>
            <form className="stacked-form" onSubmit={handleAuthSubmit}>
              {authMode === 'register' ? (
                <label>
                  Full name
                  <input
                    value={authForm.fullName}
                    onChange={(event) => setAuthForm({ ...authForm, fullName: event.target.value })}
                    required
                  />
                </label>
              ) : null}
              <label>
                Email
                <input
                  type="email"
                  value={authForm.email}
                  onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })}
                  required
                />
              </label>
              {authMode === 'register' ? (
                <label>
                  Role
                  <select
                    value={authForm.role}
                    onChange={(event) => setAuthForm({ ...authForm, role: event.target.value })}
                  >
                    <option value="student">Student</option>
                    <option value="lecturer">Lecturer</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
              ) : null}
              <button type="submit" disabled={isLoading}>
                {isLoading ? 'Please wait…' : authMode === 'register' ? 'Create account' : 'Log in'}
              </button>
            </form>
          </article>

          <article className="card">
            <h2>Included MVP features</h2>
            <ul className="feature-list">
              <li>JWT-based registration and login with student, lecturer, and admin roles</li>
              <li>Course catalog and enrollments routed through the API gateway</li>
              <li>Student profile management backed by PostgreSQL</li>
              <li>Grade publishing for lecturers/admins and grade viewing for students</li>
            </ul>
          </article>
        </section>
      ) : (
        <>
          <section className="grid two-columns dashboard-summary">
            <article className="card">
              <h2>Dashboard</h2>
              <p><strong>Name:</strong> {user.fullName}</p>
              <p><strong>Email:</strong> {user.email}</p>
              <p><strong>Role:</strong> <span className="badge">{user.role}</span></p>
              <p><strong>Enrollments:</strong> {enrollments.length}</p>
              <p><strong>Grades:</strong> {grades.length}</p>
            </article>
            <article className="card">
              <h2>Profile</h2>
              <form className="stacked-form" onSubmit={handleProfileSave}>
                <label>
                  Full name
                  <input
                    value={profile.fullName}
                    onChange={(event) => setProfile({ ...profile, fullName: event.target.value })}
                    required
                  />
                </label>
                <label>
                  Department
                  <input
                    value={profile.department}
                    onChange={(event) => setProfile({ ...profile, department: event.target.value })}
                  />
                </label>
                <label>
                  Level / Year
                  <input
                    value={profile.level}
                    onChange={(event) => setProfile({ ...profile, level: event.target.value })}
                  />
                </label>
                <button type="submit">Save profile</button>
              </form>
            </article>
          </section>

          <section className="grid two-columns">
            <article className="card">
              <div className="section-header">
                <h2>Course catalog</h2>
                <span>{courses.length} courses</span>
              </div>
              <div className="course-list">
                {courses.map((course) => (
                  <article key={course.id} className="course-card">
                    <div>
                      <p className="course-code">{course.code}</p>
                      <h3>{course.title}</h3>
                      <p>{course.description}</p>
                    </div>
                    <div className="course-meta">
                      <span>{course.credits} credits</span>
                      <span>{course.lecturerName}</span>
                    </div>
                    {user.role === 'student' ? (
                      <button
                        type="button"
                        onClick={() => handleEnroll(course.id)}
                        disabled={enrolledCourseIds.has(course.id)}
                      >
                        {enrolledCourseIds.has(course.id) ? 'Enrolled' : 'Enroll'}
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            </article>

            <article className="card">
              <h2>{user.role === 'student' ? 'My grades' : 'Recent grades'}</h2>
              <div className="table-shell">
                <table>
                  <thead>
                    <tr>
                      <th>Course</th>
                      {user.role !== 'student' ? <th>Student</th> : null}
                      <th>Score</th>
                      <th>Letter</th>
                      <th>Comments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grades.length > 0 ? grades.map((grade) => (
                      <tr key={grade.id}>
                        <td>{findCourseLabel(courses, grade.courseId)}</td>
                        {user.role !== 'student' ? <td>{grade.studentUserId}</td> : null}
                        <td>{grade.score}</td>
                        <td>{grade.letterGrade}</td>
                        <td>{grade.comments || '—'}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={user.role === 'student' ? 4 : 5}>No grades available yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          {canManageAcademics ? (
            <section className="grid two-columns">
              <article className="card">
                <h2>Create course</h2>
                <form className="stacked-form" onSubmit={handleCourseCreate}>
                  <label>
                    Course code
                    <input
                      value={courseForm.code}
                      onChange={(event) => setCourseForm({ ...courseForm, code: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Title
                    <input
                      value={courseForm.title}
                      onChange={(event) => setCourseForm({ ...courseForm, title: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      rows="3"
                      value={courseForm.description}
                      onChange={(event) => setCourseForm({ ...courseForm, description: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Credits
                    <input
                      type="number"
                      min="1"
                      max="12"
                      value={courseForm.credits}
                      onChange={(event) => setCourseForm({ ...courseForm, credits: Number(event.target.value) })}
                      required
                    />
                  </label>
                  <label>
                    Lecturer name
                    <input
                      value={courseForm.lecturerName}
                      onChange={(event) => setCourseForm({ ...courseForm, lecturerName: event.target.value })}
                      required
                    />
                  </label>
                  <button type="submit">Create course</button>
                </form>
              </article>

              <article className="card">
                <h2>Publish grade</h2>
                <form className="stacked-form" onSubmit={handleGradeSubmit}>
                  <label>
                    Student user ID
                    <input
                      value={gradeForm.studentUserId}
                      onChange={(event) => setGradeForm({ ...gradeForm, studentUserId: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Course
                    <select
                      value={gradeForm.courseId}
                      onChange={(event) => setGradeForm({ ...gradeForm, courseId: event.target.value })}
                      required
                    >
                      <option value="">Select a course</option>
                      {courses.map((course) => (
                        <option key={course.id} value={course.id}>{course.code} — {course.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Score
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={gradeForm.score}
                      onChange={(event) => setGradeForm({ ...gradeForm, score: event.target.value })}
                      required
                    />
                  </label>
                  <label>
                    Comments
                    <textarea
                      rows="3"
                      value={gradeForm.comments}
                      onChange={(event) => setGradeForm({ ...gradeForm, comments: event.target.value })}
                    />
                  </label>
                  <button type="submit">Save grade</button>
                </form>
              </article>
            </section>
          ) : null}

          <section className="card">
            <h2>My enrollments</h2>
            <div className="table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Course</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.length > 0 ? enrollments.map((enrollment) => (
                    <tr key={enrollment.id}>
                      <td>{findCourseLabel(courses, enrollment.courseId)}</td>
                      <td>{enrollment.status}</td>
                      <td>{new Date(enrollment.createdAt).toLocaleString()}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="3">No enrollments yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

async function apiFetch(pathname, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }

  if (options.token) {
    headers.Authorization = 'Bearer ' + options.token
  }

  const response = await fetch(`${API_BASE_URL}${pathname}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const responseContentType = response.headers.get('content-type') || ''
  const payload = responseContentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    throw new Error(typeof payload === 'string' ? payload : payload.error || 'Request failed')
  }

  return payload
}

function readStoredUser() {
  try {
    const rawValue = localStorage.getItem(USER_STORAGE_KEY)
    return rawValue ? JSON.parse(rawValue) : null
  } catch {
    return null
  }
}

function findCourseLabel(courses, courseId) {
  const matchingCourse = courses.find((course) => course.id === courseId)
  return matchingCourse ? `${matchingCourse.code} — ${matchingCourse.title}` : courseId
}

export default App
