# Book Quest

Book Quest is a self-paced AI tutor for lifelong learners. Learners can build a course from uploaded PDFs or generate one from scratch, then progress through lessons, homework, quizzes, midterms, and finals.

## Core principles

- Personalized onboarding with learner background, interests, and preferred tutor character.
- Progression gates: complete current material before unlocking the next unit.
- Adaptive difficulty: weak concepts are resurfaced in later assessments.
- Editable AI memory/state through markdown documents (`SOUL.md`, `PROFILE.md`, `PREFERENCES.md`, `MEMORY.md`).

## Tech stack

- Next.js + TypeScript
- Supabase (Auth, Postgres, Storage)
- OpenAI API

## Quick start (one command)

1. Clone repo
2. Optionally set your key in `.env.local` (required for AI calls):

```bash
cp .env.example .env.local
# edit OPENAI_API_KEY
```

3. Start everything:

```bash
npm run start:local
```

Before running, ensure Docker Desktop is open.

This command will:

- install npm dependencies if missing
- create `.env.local` from `.env.example` if missing
- start Supabase locally through Docker
- sync local Supabase keys into `.env.local`
- run first-time DB reset/seed (or migrations on later runs)
- start the Next.js dev server

## Useful scripts

- `npm run start:local`: full local startup flow
- `npm run stop:local`: stop local Supabase stack
- `npm run db:reset`: reset local DB and re-run migrations + seed
- `npm run migrate:up`: apply pending migrations locally
- `npm run supabase:status`: print local Supabase service URLs and keys

## Project structure

- `app/`: Next.js app and API routes
- `lib/state/`: Markdown state engine (`SOUL.md` etc.)
- `state/templates/`: default markdown templates
- `supabase/migrations/`: schema migrations
- `docs/`: product and agentic architecture notes
- `docs/adr/`: architecture decision records

## MVP status

Initial scaffold includes:

- contributor-friendly local setup scripts
- baseline schema for learners/courses/assessments/mastery
- markdown state documents and API route for editing state files
