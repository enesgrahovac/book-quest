# Book Quest — Project Reference

## Tech Stack
- **Framework:** Next.js 14 (App Router), React 18, TypeScript
- **Styling:** CSS custom properties in `app/globals.css` — no Tailwind, no CSS-in-JS
- **AI:** Vercel AI SDK (`ai` package), `generateObject` with Zod schemas
- **Validation:** Zod v4
- **PDF:** `unpdf` for text extraction

## Key Directories
- `app/` — Next.js App Router pages and API routes
- `lib/ai/` — AI agent logic (`courseCreationAgent.ts`, `model.ts`)
- `lib/pdf/` — PDF parsing and book analysis
- `lib/state/` — File-based state helpers (`courseFiles.ts`, `userState.ts`)
- `state/users/{userId}/` — Per-user data (markdown docs + JSON sidecar files)

## Styling Convention
All styles use CSS custom properties defined in `app/globals.css`. Class names are camelCase applied directly in JSX. No component-level CSS modules.

## State Architecture
File-based, no database. User data lives at `state/users/{userId}/`:
- Markdown docs: `PROFILE.md`, `PREFERENCES.md`, `TUTOR_PERSONA.md`, `MEMORY.md`, `SOUL.md`
- JSON sidecar: `_onboarding_state.json`
- Courses: `courses/{courseId}/` with `course_plan.json`, `book_analysis.json`, `extracted_text.json`

## Model Config
`LLM_MODEL` env var in `provider:modelId` format (e.g. `anthropic:claude-sonnet-4-20250514`).
Parsed in `lib/ai/model.ts`. Default: `openai:gpt-5.2`. Supports `openai` and `anthropic` providers.

## Agent Patterns
- All agent functions use `generateObject` with Zod schemas for structured output
- SSE streaming for the chat conversation (`mode: next`)
- Non-streaming for plan generation/editing (`mode: generate-plan`, `edit-plan`, `finalize`)
- Course creation agent modes: `next` | `generate-plan` | `edit-plan` | `finalize`

## MVP User ID
Hardcoded as `"local-learner"` throughout the app.

## PROJECT_LOG Convention
AI-authored entries in `PROJECT_LOG.md` are wrapped in `[AI]` brackets:
```
[AI - February 25th, 2026] Completed <task description>.
```
