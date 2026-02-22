# ADR-0001: Architecture and Local Development Baseline

- Status: Accepted
- Date: 2026-02-22
- Decision Makers: Book Quest maintainers

## Context

Book Quest is an open-source, learner-first AI tutoring product. The project needs:

- fast contributor onboarding
- reliable local development
- clear extension points for AI agent flows
- persistent, editable learner/tutor state

## Decision

1. Use `Next.js + TypeScript` for the web application.
2. Use `Supabase` (Auth, Postgres, Storage) as the backend platform.
3. Standardize local setup on Docker + Supabase CLI and provide one command: `npm run start:local`.
4. Represent learner/tutor AI state as editable markdown documents (`SOUL.md`, `PROFILE.md`, `PREFERENCES.md`, `MEMORY.md`, `TUTOR_PERSONA.md`).
5. Keep Postgres as the canonical source of truth for learning progression, assessment, and analytics; markdown files are the editable projection used by tutor/agent flows.

## Consequences

### Positive

- Contributors can run locally with minimal setup overhead.
- Product state is transparent and human-editable.
- Gated progression and adaptive difficulty can be implemented with queryable structured data.
- AI behavior can evolve via markdown state and prompts without blocking schema-level evolution.

### Tradeoffs

- Dual-state model (DB + markdown projection) requires explicit synchronization logic.
- Local environment depends on Docker availability and health.
- Supabase platform choices may require adapter work if backend providers change later.

## Follow-up Work

1. Add ADR for assessment grading strategy (deterministic vs model-evaluated paths).
2. Add ADR for agent orchestration runtime and job scheduling.
3. Add ADR for auth strategy and row-level security hardening before public beta.
