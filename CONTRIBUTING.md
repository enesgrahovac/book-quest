# Contributing to Book Quest

## Local development

1. Install Node.js 20+ and Docker.
2. Copy env and set OpenAI key:

```bash
cp .env.example .env.local
```

3. Run:

```bash
npm run start:local
```

## Branching

- Use short-lived feature branches.
- Open small PRs with focused changes.

## Pull requests

- Add a clear summary and testing notes.
- Include screenshots for UI changes.
- Keep docs/schema changes in the same PR when relevant.

## Coding guidelines

- TypeScript strict mode.
- Prefer small composable modules.
- Keep AI prompts and state transitions explicit and versioned.

