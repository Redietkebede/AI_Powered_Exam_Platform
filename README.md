# AI-Powered Exam Platform

The AI-Powered Exam Platform is a modern solution that streamlines exam creation, delivery, and analysis using AI-assisted question generation, adaptive testing, and analytics. It provides candidates with a personalized assessment experience while enabling administrators, editors, and recruiters to efficiently manage exams and make data-driven decisions. With a focus on adaptability, security, and usability, the platform enhances the accuracy, efficiency, and overall quality of educational and professional evaluations.

## Features
- Adaptive Question Selection: Adjusts difficulty based on candidate performance.
- Role-Based Access Control: Manages permissions for all user types.
- AI-Assisted Question Generation: Automates question creation.
- Centralized Question Bank: Organizes questions efficiently.
- Exam Delivery: Provides secure, controlled sessions.
- Analytics: Tracks performance and insights.
- Optional temperature controls for AI generation (min/max)

## Tech Stack
- Backend: Node.js, Express, TypeScript, PostgreSQL (`pg`), Firebase Admin, Zod
- Frontend: React, TypeScript, Vite, Tailwind CSS
- LLM: OpenAI‑compatible API (e.g., OpenRouter)

## Getting Started
Prerequisites
- Node.js 18+
- PostgreSQL 13+

## Project Structure

```text
.
├─ server/
│  ├─ src/
│  │  ├─ config/          # db pool, firebase admin bootstrap
│  │  ├─ controllers/     # exams, sessions, questions, attempts, analytics...
│  │  ├─ middleware/      # auth (verifyToken), authorize, zod error formatting
│  │  ├─ prompts/         # LLM prompt template (prompt.ts)
│  │  ├─ routes/          # authRoutes, questionsRoutes, examRoutes, sessionsRoutes, ...
│  │  ├─ schemas/         # zod schemas (e.g., CreateQuestionSchema, ReqSchema)
│  │  ├─ services/        # exam structure, generation, analytics helpers
│  │  └─ types/ utils/    # shared types and helpers
│  ├─ seedQuestions.ts    # quick seed for questions
│  └─ generate-id-token.ts# local helper to mint Firebase custom/ID tokens (dev)
├─ client/
│  ├─ src/
│  │  ├─ pages/           # dashboards, exam flow, question bank, analytics
│  │  ├─ services/        # api.ts wrapper, examService, questionService, aiService, authService
│  │  ├─ lib/api.ts       # API base URL resolution + auth header injection
│  │  └─ types/ hooks/    # FE types, util hooks

```

1) Clone & Install
```bash
cd server && npm install
cd ../client && npm install
```

2) Configuration Setup
 
 Define the following environment variables:

Server (`server/.env`)
##### Web server
```bash
PORT=2800
CORS_ORIGIN=http://localhost:5173
```
##### Database Setup
```bash
# 1) Create database (name: ai_db)
createdb ai_db

# 2) (Optional) export a DATABASE_URL used by scripts and tools
export DATABASE_URL="postgres://postgres:YOUR_PASS@localhost:5432/ai_db"

# 3) Apply schema (DDL)
psql ai_db -v ON_ERROR_STOP=1 -f server/src/db/DB_schema/init.sql

# 4) Sanity check: list tables
psql aiep -c '\dt'
```
###### PostgreSQL Port
```bash
DATABASE_URL=postgres://user:pass@localhost:5432/ai_db
```
##### Firebase Auth Setup
- Create a Firebase project → enable Email/Password (or other) sign-in.
- Create a Service Account (Project settings → Service accounts → Generate new private key).
- Copy the values into FIREBASE_* env vars (do not commit the JSON).
```bash
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=service-account@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```
- For local testing you can mint a token:
```bash
cd server
npx ts-node generate-id-token.ts
```
##### LLM / OpenRouter
- Create a OpenRouter Account
- Create and copy the api key (From the DropDown → Keys → Create Api key → Copy the key)
```bash
OPENROUTER_API_KEY=sk-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=openai/gpt-4o-mini
LLM_TEMP_MIN=0.1
LLM_TEMP_MAX=0.9
```

Client (`client/.env`)
```bash
VITE_API_BASE=http://localhost:2800/api
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_APP_ID=1:...:web:...
VITE_FIREBASE_MEASUREMENT_ID=G-...
```


Then call /api/auth/me with Authorization: Bearer <idToken>.

3) Run
Backend:
```bash
cd server
npm run dev
# http://localhost:2800
```

Frontend:
```bash
cd client
npm run dev
# http://localhost:5173
```

4) Sanity Checks
- `GET http://localhost:2800/health`
- `GET http://localhost:2800/db-test`


## API Endpoints (Quick Map)

Base path defaults to /api (client auto-falls back if VITE_API_BASE isn’t set).

### Auth
- GET /api/auth/me → current user (requires Authorization: Bearer <idToken>)

### Questions
- POST /api/questions/generate → body accepts either { topic, difficulty, count } or { topic, difficulty, numberOfQuestions } + optional adaptive knobs (see below). Returns generated items.
- POST /api/questions → create manual question (admin/editor)
- GET /api/questions → list (filterable)
- DELETE /api/questions/:id → delete one
- GET /api/questions/topics → list topics with counts
- GET /api/questions/available?topic=JS&type=MCQ → count available
- GET /api/questions/sufficiency?topic=JS&needed=25 → sufficiency check

### Exams / Sessions
- POST /api/exams/start → start an exam (creates session, freezes questions)
- GET /api/sessions/:id/topic → topic and metadata for session
- POST /api/sessions/:id/submit → submit answers for session
- GET /api/sessions/:id/remaining → remaining time

### Attempts / Analytics
- GET /api/attempts → attempts for user / topic
- GET /api/analytics/summary?topic=... → KPIs (candidates, exams, avgScore, questions)
- GET /api/analytics/timeline?topic=...
- GET /api/analytics/by-difficulty?topic=...

##### Roles: Admin/Editor/Recruiter/Candidate routes are protected via verifyToken + authorize([...]).

### Adaptive Engine & Generation Knobs
#### The generator endpoint normalizes two request shapes via Zod (ReqSchema) and supports extra knobs:
- stageSize (default 10)
- bufferFactor (default 4)
- levelMixPerStage (optional object with keys 1..5)
- poolMultiplier (default 3)
- comment (optional free-text note for editors)

#### Prompt template lives in server/src/prompts/prompt.ts and enforces:
- Exactly 4 options A–D, randomized.
- correct_answer is zero-based index (0..3).
- Explanations + tags encouraged.
- Rate Limiting, CORS & Security
- Rate limit: express-rate-limit at ~100 req/min (see src/index.ts).
- CORS: set CORS_ORIGIN (comma-separated for multiple) in server .env.
- Auth: Firebase ID tokens on every request (Authorization: Bearer ...).
- Secrets: never commit .env or service account JSON; publish .env.example only.

### Troubleshooting
- 401 /auth/me: ensure the client is signed in to Firebase and you’re passing a fresh ID token. In dev, restart FE so onAuthStateChanged refreshes the token cache.
- DB errors /db-test: recheck DATABASE_URL, ensure DB up, and run schema SQL.
- LLM errors:
  - Daily/plan limits: some providers (e.g., OpenRouter) throttle. If you see “quota exceeded”, switch model or wait for reset.
  - Tip: We pass comment in the request body for internal audit; the provider only sees the final prompt string—avoid sending non-prompt metadata to the LLM API params.
  - Configure LLM_BASE_URL, LLM_MODEL, and tempering via LLM_TEMP_MIN/MAX.
- CORS: set CORS_ORIGIN=http://localhost:5173 (and others as needed).
- Ports mismatch: FE expects VITE_API_BASE=http://localhost:2800/api.

## Architecture (brief)
- Client (React) authenticates via Firebase and calls the API with `Authorization: Bearer <idToken>`.
- Server (Express) verifies tokens, enforces roles, serves exam and question workflows.
- PostgreSQL persists users, questions, tests, sessions, frozen session questions, and answers.
- LLM (OpenAI‑compatible) supports smart question generation.
 
## Contributors
- [Rediet Worede](https://github.com/Redietkebede) (@Redietkebede)
- [Kaku Temesgen](https://github.com/fenitamas) (@fenitamas)
