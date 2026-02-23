import { generateObject } from "ai";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { z } from "zod";

import { getModel } from "../ai/model";
import { readUserStateDoc, writeUserStateDoc } from "./userState";

export const TUTOR_CHARACTERS = [
  "supportive-coach",
  "strict-professor",
  "calm-mentor",
  "energetic-guide"
] as const;

export const CORRECTION_STYLES = ["direct", "socratic", "mixed"] as const;
export const EXPLANATION_DEPTHS = ["concise", "deep"] as const;
export const CHALLENGE_LEVELS = ["easy", "balanced", "stretch"] as const;

export type TutorCharacter = (typeof TUTOR_CHARACTERS)[number];
export type CorrectionStyle = (typeof CORRECTION_STYLES)[number];
export type ExplanationDepth = (typeof EXPLANATION_DEPTHS)[number];
export type ChallengeLevel = (typeof CHALLENGE_LEVELS)[number];

export type OnboardingAnswers = {
  displayName: string;
  educationLevel: string;
  educationBackground?: string;
  primaryGoal: string;
  weeklyHours: number;
  knownTopics: string[];
  interests: string[];
  explanationDepth: ExplanationDepth;
  challengeLevel: ChallengeLevel;
  tutorCharacter: TutorCharacter;
  correctionStyle: CorrectionStyle;
  personaPreferenceNotes?: string[];
};

const ONBOARDING_DOC_KEYS = ["PROFILE", "PREFERENCES", "TUTOR_PERSONA", "MEMORY"] as const;
const LLM_EDITABLE_DOC_KEYS = ["PROFILE", "PREFERENCES", "MEMORY"] as const;
type OnboardingDocKey = (typeof LLM_EDITABLE_DOC_KEYS)[number];

type OnboardingDocSources = Record<(typeof ONBOARDING_DOC_KEYS)[number], string>;

const characterLabels: Record<TutorCharacter, string> = {
  "supportive-coach": "Supportive coach",
  "strict-professor": "Strict professor",
  "calm-mentor": "Calm mentor",
  "energetic-guide": "Energetic guide"
};

const correctionLabels: Record<CorrectionStyle, string> = {
  direct: "Direct correction",
  socratic: "Socratic guidance",
  mixed: "Mixed style"
};

type TutorPersonaPreset = {
  title: string;
  voice: string;
  cadence: string;
  strengths: string[];
};

const tutorPersonaPresets: Record<TutorCharacter, TutorPersonaPreset> = {
  "supportive-coach": {
    title: "Supportive coach",
    voice: "Warm, confident, and practical. Celebrates progress without being fluffy.",
    cadence: "Short teaching bursts followed by quick checks and actionable next steps.",
    strengths: [
      "Normalize mistakes as part of growth while keeping standards high.",
      "Turn abstract ideas into concrete, real-world examples quickly.",
      "End each step with one clear, doable action."
    ]
  },
  "strict-professor": {
    title: "Strict professor",
    voice: "Precise, direct, and academically rigorous.",
    cadence: "Clear definitions first, then demanding questions that test understanding.",
    strengths: [
      "Flags weak reasoning immediately and explains why it is wrong.",
      "Requires explicit justification, not vague intuition.",
      "Prioritizes mastery before moving to the next concept."
    ]
  },
  "calm-mentor": {
    title: "Calm mentor",
    voice: "Steady, patient, and reassuring under confusion.",
    cadence: "Slow build-up from foundations, with consistent reflection prompts.",
    strengths: [
      "De-escalates overwhelm and clarifies one layer at a time.",
      "Connects ideas into a coherent mental model.",
      "Encourages thoughtful self-explanation before revealing solutions."
    ]
  },
  "energetic-guide": {
    title: "Energetic guide",
    voice: "High-energy, optimistic, and momentum-focused.",
    cadence: "Fast loops of explain -> try -> feedback -> level up.",
    strengths: [
      "Keeps sessions lively and challenge-forward.",
      "Uses vivid analogies and mini-challenges to sustain engagement.",
      "Balances speed with quick comprehension checks."
    ]
  }
};

const requiredDocHeadings: Record<OnboardingDocKey, string> = {
  PROFILE: "# PROFILE",
  PREFERENCES: "# PREFERENCES",
  MEMORY: "# MEMORY"
};

function normalizeBulletItems(items: string[]) {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/\r?\n/g, " "));
}

function markdownList(items: string[], fallback: string) {
  const normalized = normalizeBulletItems(items);
  if (!normalized.length) {
    return `- ${fallback}`;
  }

  return normalized.map((item) => `- ${item}`).join("\n");
}

function markdownSafeLine(value: string) {
  return value.trim().replace(/\r?\n/g, " ");
}

function normalizeModelDoc(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? `${trimmed}\n` : null;
}

function isValidOnboardingDoc(key: OnboardingDocKey, content: string) {
  return content.startsWith("---") && content.includes(requiredDocHeadings[key]);
}

async function readOnboardingDocSources(userId: string): Promise<OnboardingDocSources> {
  const [profile, preferences, tutorPersona, memory] = await Promise.all([
    readUserStateDoc(userId, "PROFILE"),
    readUserStateDoc(userId, "PREFERENCES"),
    readUserStateDoc(userId, "TUTOR_PERSONA"),
    readUserStateDoc(userId, "MEMORY")
  ]);

  return {
    PROFILE: profile.content,
    PREFERENCES: preferences.content,
    TUTOR_PERSONA: tutorPersona.content,
    MEMORY: memory.content
  };
}

async function rewriteOnboardingDocsWithLlm(
  answers: OnboardingAnswers,
  currentDocs: Omit<OnboardingDocSources, "TUTOR_PERSONA">
) {
  if (!process.env.OPENAI_API_KEY) {
    return {} as Partial<Record<OnboardingDocKey, string>>;
  }

  const systemPrompt = [
    "You edit learner markdown state files using onboarding answers.",
    "Rewrite each document so it reads like clean, concise profile state.",
    "Do not paste raw interview wording or transcript-like text.",
    "Preserve each file's YAML frontmatter and overall structure.",
    "Keep headings, but update body content to reflect answers accurately.",
    "If some answer is missing, keep sensible existing/template defaults.",
    "Return JSON only with keys: PROFILE, PREFERENCES, MEMORY."
  ].join("\n");

  const userPrompt = [
    "Structured onboarding answers:",
    "```json",
    JSON.stringify(
      {
        ...answers,
        tutorCharacterLabel: characterLabels[answers.tutorCharacter],
        correctionStyleLabel: correctionLabels[answers.correctionStyle]
      },
      null,
      2
    ),
    "```",
    "",
    "Current markdown docs to edit:",
    "### PROFILE",
    "```md",
    currentDocs.PROFILE,
    "```",
    "### PREFERENCES",
    "```md",
    currentDocs.PREFERENCES,
    "```",
    "### MEMORY",
    "```md",
    currentDocs.MEMORY,
    "```"
  ].join("\n");

  try {
    const { object: parsed } = await generateObject({
      model: getModel(),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.2,
      schema: z.object({
        PROFILE: z.string(),
        PREFERENCES: z.string(),
        MEMORY: z.string()
      })
    });

    const output: Partial<Record<OnboardingDocKey, string>> = {};

    for (const key of LLM_EDITABLE_DOC_KEYS) {
      const candidate = normalizeModelDoc(parsed[key]);
      if (!candidate || !isValidOnboardingDoc(key, candidate)) {
        continue;
      }
      output[key] = candidate;
    }

    return output;
  } catch {
    return {} as Partial<Record<OnboardingDocKey, string>>;
  }
}

function buildProfileMarkdown(answers: OnboardingAnswers) {
  return `---
version: 1
owner: learner
purpose: learner_profile
---

# PROFILE

## Display name

${markdownSafeLine(answers.displayName)}

## Education level

${markdownSafeLine(answers.educationLevel)}

## Education background details

${markdownSafeLine(answers.educationBackground ?? "Not shared yet")}

## Primary goal

${markdownSafeLine(answers.primaryGoal)}

## Weekly study commitment

${answers.weeklyHours} hours/week

## Topics already comfortable

${markdownList(answers.knownTopics, "None shared yet")}

## Interests for examples

${markdownList(answers.interests, "General real-world examples")}
`;
}

function buildPreferencesMarkdown(answers: OnboardingAnswers) {
  const personaNotes = markdownList(
    answers.personaPreferenceNotes ?? [],
    "No custom persona edits yet; keep the signature baseline."
  );

  return `---
version: 1
owner: learner
purpose: learning_preferences
---

# PREFERENCES

## Preferred pace

Self-paced

## Explanation depth

${answers.explanationDepth}

## Challenge level

${answers.challengeLevel}

## Preferred tutor character

${characterLabels[answers.tutorCharacter]}

## Correction style

${correctionLabels[answers.correctionStyle]}

## Tutor persona customizations

${personaNotes}

## Example personalization tags

${markdownList(answers.interests, "General examples")}
`;
}

function buildTutorPersonaMarkdown(answers: OnboardingAnswers) {
  const preset = tutorPersonaPresets[answers.tutorCharacter];
  const personaNotes = markdownList(
    answers.personaPreferenceNotes ?? [],
    "No custom edits from learner yet. Use the signature baseline."
  );

  return `---
version: 1
owner: tutor
purpose: tutor_persona
---

# TUTOR PERSONA

Character baseline: ${preset.title}.
Correction style: ${correctionLabels[answers.correctionStyle]}.

## Signature voice and rhythm

- Voice: ${preset.voice}
- Cadence: ${preset.cadence}
Core strengths:
${markdownList(preset.strengths, "Clear explanations and helpful checks")}

## Learner-requested persona edits

${personaNotes}

You are an adaptive tutor for ${markdownSafeLine(answers.displayName)}.
Teach at a ${answers.challengeLevel} difficulty target with ${answers.explanationDepth} explanations.

Always:
- Tie examples to learner interests when possible.
- Ask short understanding checks after important ideas.
- Keep progression self-paced while reinforcing weak concepts.
`;
}

function buildMemoryMarkdown(answers: OnboardingAnswers) {
  return `---
version: 1
owner: learner
purpose: learning_memory
---

# MEMORY

## Onboarding snapshot

- Goal: ${markdownSafeLine(answers.primaryGoal)}
- Weekly commitment: ${answers.weeklyHours} hours/week
- Tutor character: ${characterLabels[answers.tutorCharacter]}
- Correction style: ${correctionLabels[answers.correctionStyle]}

## Concepts to reinforce

${markdownList(answers.knownTopics, "To be discovered from early assessments")}

## Personalization tags

${markdownList(answers.interests, "General real-world examples")}
`;
}

export async function applyOnboardingAnswers(userId: string, answers: OnboardingAnswers) {
  const currentDocs = await readOnboardingDocSources(userId);
  const llmEdits = await rewriteOnboardingDocsWithLlm(answers, {
    PROFILE: currentDocs.PROFILE,
    PREFERENCES: currentDocs.PREFERENCES,
    MEMORY: currentDocs.MEMORY
  });

  const profileDoc = await writeUserStateDoc(
    userId,
    "PROFILE",
    llmEdits.PROFILE ?? buildProfileMarkdown(answers)
  );
  const preferencesDoc = await writeUserStateDoc(
    userId,
    "PREFERENCES",
    llmEdits.PREFERENCES ?? buildPreferencesMarkdown(answers)
  );
  const personaDoc = await writeUserStateDoc(
    userId,
    "TUTOR_PERSONA",
    buildTutorPersonaMarkdown(answers)
  );
  const memoryDoc = await writeUserStateDoc(
    userId,
    "MEMORY",
    llmEdits.MEMORY ?? buildMemoryMarkdown(answers)
  );

  return [profileDoc, preferencesDoc, personaDoc, memoryDoc];
}

// ---------------------------------------------------------------------------
// Progressive onboarding state (sidecar file)
// ---------------------------------------------------------------------------

export type PartialOnboardingAnswers = {
  [K in keyof OnboardingAnswers]?: OnboardingAnswers[K] | null;
};

function onboardingStatePath(userId: string) {
  const rootDir = path.resolve(process.cwd(), process.env.BOOK_QUEST_STATE_DIR ?? "state/users");
  return path.join(rootDir, userId, "_onboarding_state.json");
}

export async function readOnboardingState(userId: string): Promise<PartialOnboardingAnswers> {
  try {
    const raw = await readFile(onboardingStatePath(userId), "utf8");
    return JSON.parse(raw) as PartialOnboardingAnswers;
  } catch {
    return {};
  }
}

export async function writeOnboardingState(
  userId: string,
  state: PartialOnboardingAnswers
): Promise<void> {
  const filePath = onboardingStatePath(userId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
}

export async function applyPartialOnboardingUpdate(
  userId: string,
  partial: PartialOnboardingAnswers
): Promise<void> {
  const current = await readOnboardingState(userId);

  // Merge: only overwrite with non-null values
  for (const key of Object.keys(partial) as Array<keyof OnboardingAnswers>) {
    const value = partial[key];
    if (value !== null && value !== undefined) {
      (current as Record<string, unknown>)[key] = value;
    }
  }

  await writeOnboardingState(userId, current);

  // Build and write TUTOR_PERSONA.md with whatever we have so far
  const merged = buildDefaultsFromPartial(current);
  await writeUserStateDoc(userId, "TUTOR_PERSONA", buildTutorPersonaMarkdown(merged));

  // If we have enough fields, also write PROFILE.md and PREFERENCES.md
  if (merged.displayName !== "Learner" || merged.primaryGoal !== "Not shared yet") {
    await writeUserStateDoc(userId, "PROFILE", buildProfileMarkdown(merged));
    await writeUserStateDoc(userId, "PREFERENCES", buildPreferencesMarkdown(merged));
  }
}

function buildDefaultsFromPartial(partial: PartialOnboardingAnswers): OnboardingAnswers {
  return {
    displayName: (partial.displayName as string) || "Learner",
    educationLevel: (partial.educationLevel as string) || "Unknown",
    educationBackground: (partial.educationBackground as string) || "Not shared yet",
    primaryGoal: (partial.primaryGoal as string) || "Not shared yet",
    weeklyHours: typeof partial.weeklyHours === "number" ? partial.weeklyHours : 5,
    knownTopics: Array.isArray(partial.knownTopics) ? partial.knownTopics : [],
    interests: Array.isArray(partial.interests) ? partial.interests : [],
    explanationDepth: (EXPLANATION_DEPTHS as readonly string[]).includes(
      partial.explanationDepth as string
    )
      ? (partial.explanationDepth as ExplanationDepth)
      : "deep",
    challengeLevel: (CHALLENGE_LEVELS as readonly string[]).includes(
      partial.challengeLevel as string
    )
      ? (partial.challengeLevel as ChallengeLevel)
      : "balanced",
    tutorCharacter: (TUTOR_CHARACTERS as readonly string[]).includes(
      partial.tutorCharacter as string
    )
      ? (partial.tutorCharacter as TutorCharacter)
      : "supportive-coach",
    correctionStyle: (CORRECTION_STYLES as readonly string[]).includes(
      partial.correctionStyle as string
    )
      ? (partial.correctionStyle as CorrectionStyle)
      : "mixed",
    personaPreferenceNotes: Array.isArray(partial.personaPreferenceNotes)
      ? partial.personaPreferenceNotes
      : []
  };
}
