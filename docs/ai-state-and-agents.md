# AI State and Agentic Flows

## Editable markdown state

Each learner owns editable markdown files:

- `SOUL.md`: stable tutor values and behavioral boundaries.
- `PROFILE.md`: education history, goals, and domain interests.
- `PREFERENCES.md`: pace, style, and preferred tutor character.
- `MEMORY.md`: learning events, weak areas, and progress notes.
- `TUTOR_PERSONA.md`: operating prompt for voice/character.

These files are generated from templates and can be edited via API/UI.

## Agent roles

- Onboarding agent: collects learner context and tutor character preference.
- Planner agent: builds learning path from PDF corpus or topic request.
- Assessment agent: produces homework/quiz/midterm/final tasks.
- Grader agent: evaluates MCQ and free-form correctness.
- Memory agent: updates markdown + mastery state after submissions.

## Source of truth strategy

- Postgres tables are canonical for analytics and gating logic.
- Markdown state is a human-editable projection synchronized with system state.
