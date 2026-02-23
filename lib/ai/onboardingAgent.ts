import { generateObject } from "ai";
import { z } from "zod";

import {
  applyOnboardingAnswers,
  applyPartialOnboardingUpdate,
  CHALLENGE_LEVELS,
  CORRECTION_STYLES,
  EXPLANATION_DEPTHS,
  TUTOR_CHARACTERS,
  type ChallengeLevel,
  type CorrectionStyle,
  type ExplanationDepth,
  type OnboardingAnswers,
  type PartialOnboardingAnswers,
  type TutorCharacter
} from "@/lib/state/onboarding";

import { getModel } from "./model";

export type ConversationMessage = {
  role: "assistant" | "user";
  content: string;
};

type NextQuestionPayload = {
  question: string;
  readyToFinalize: boolean;
  knownGaps: string[];
};

function normalizeMessages(messages: ConversationMessage[]) {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().replace(/\r?\n/g, " ")
    }));
}

function transcriptString(messages: ConversationMessage[]) {
  return normalizeMessages(messages)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
}

function fallbackNextQuestion(messages: ConversationMessage[]): NextQuestionPayload {
  const userAnswers = messages.filter((message) => message.role === "user");
  const steps = [
    "Hey there! I'm your Book Quest tutor — excited to meet you! What's your name, and what do you do? Tell me a bit about yourself (and if you're currently studying something, I'd love to hear about that too).",
    "Awesome, thanks for sharing that! So what's the main thing you're hoping to learn or get better at? And roughly how many hours a week do you think you can set aside for studying?",
    "Got it! Are there any topics you already feel pretty solid on? And what are some of your hobbies or interests? I like to work those into examples to make things click better.",
    "This is really helpful! Now, when you get something wrong, would you rather I just tell you the answer and explain why, or would you prefer I give you a nudge so you can figure it out yourself? Also, what kind of vibe works best for you — someone who's super encouraging, more no-nonsense and direct, calm and patient, or high-energy and fast-paced?",
    "Almost done! When I'm explaining something, do you like it short and to the point, or do you prefer me to really walk you through it step by step? And for practice questions, should they feel comfortable, just right, or should I push you a bit?"
  ];

  const nextIndex = Math.min(userAnswers.length, steps.length - 1);
  const ready = userAnswers.length >= steps.length;

  return {
    question: ready
      ? "I think I've got a great picture of how to work with you! Is there anything else you'd like me to know, or are you ready to get started?"
      : steps[nextIndex],
    readyToFinalize: ready,
    knownGaps: ready ? [] : ["Your background and learning preferences"]
  };
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]) {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  const found = allowed.find((item) => item === normalized);
  return found ?? fallback;
}

function ensureString(value: unknown, fallback: string) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  return value.trim();
}

function ensureStringList(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length ? normalized : fallback;
}

function fallbackExtraction(messages: ConversationMessage[]): OnboardingAnswers {
  const userText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ");

  return {
    displayName: "Learner",
    educationLevel: "Unknown",
    educationBackground: userText.slice(0, 400) || "Not shared yet",
    primaryGoal: "Build stronger fundamentals through self-paced study.",
    weeklyHours: 5,
    knownTopics: [],
    interests: [],
    explanationDepth: "deep",
    challengeLevel: "balanced",
    tutorCharacter: "supportive-coach",
    correctionStyle: "mixed",
    personaPreferenceNotes: []
  };
}

export async function generateNextOnboardingQuestion(messages: ConversationMessage[]) {
  const cleanMessages = normalizeMessages(messages);
  if (!process.env.OPENAI_API_KEY) {
    return fallbackNextQuestion(cleanMessages);
  }

  const systemPrompt = [
    "You ARE the student's Book Quest tutor, meeting them for the first time.",
    "You are warm, conversational, and genuinely curious about the student.",
    "Speak like a real person — not a survey bot or form wizard.",
    "",
    "Rules:",
    "- NEVER list enum options or technical values. Infer preferences from natural conversation.",
    "- Ask exactly ONE question (or a closely related pair) per turn.",
    "- Adapt based on what the student has already shared; skip topics they've covered.",
    "- Sound encouraging and real. Use contractions, casual phrasing, and react to what they say.",
    "",
    "You need to naturally learn about the student across these areas:",
    "- Their name and education background (school, what they studied)",
    "- What they want to learn and how many hours/week they can commit",
    "- Topics they already know well, plus hobbies/interests (for personalizing examples)",
    "- How they prefer to be corrected (just tell me vs. nudge me to figure it out vs. a mix)",
    "- What teaching vibe they like (encouraging & warm, strict & direct, calm & patient, or high-energy & fast)",
    "- Whether they prefer short explanations or deep walkthroughs",
    "- Whether practice questions should feel comfortable, just right, or challenging"
  ].join("\n");

  const userPrompt = [
    "Conversation transcript:",
    transcriptString(cleanMessages) || "(empty)",
    "",
    "If enough info exists, set readyToFinalize=true and ask a final optional catch-all question.",
    "knownGaps should be a short, friendly list of what's still missing, written in second person (addressing 'you')."
  ].join("\n");

  try {
    const { object: response } = await generateObject({
      model: getModel(),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      schema: z.object({
        question: z.string(),
        readyToFinalize: z.boolean(),
        knownGaps: z.array(z.string())
      })
    });

    return {
      question: ensureString(response.question, fallbackNextQuestion(cleanMessages).question),
      readyToFinalize: Boolean(response.readyToFinalize),
      knownGaps: ensureStringList(response.knownGaps)
    };
  } catch {
    return fallbackNextQuestion(cleanMessages);
  }
}

export async function finalizeOnboardingFromConversation(
  userId: string,
  messages: ConversationMessage[]
) {
  const cleanMessages = normalizeMessages(messages);

  let extracted: OnboardingAnswers;
  if (!process.env.OPENAI_API_KEY) {
    extracted = fallbackExtraction(cleanMessages);
  } else {
    const systemPrompt = [
      "You extract structured onboarding data for Book Quest.",
      "Map conversation into the requested JSON structure.",
      "If unknown, choose sensible defaults, but preserve user-provided detail in educationBackground."
    ].join("\n");

    const userPrompt = ["Conversation transcript:", transcriptString(cleanMessages) || "(empty)"].join(
      "\n"
    );

    try {
      const { object: parsed } = await generateObject({
        model: getModel(),
        system: systemPrompt,
        prompt: userPrompt,
        temperature: 0.3,
        schema: z.object({
          displayName: z.string(),
          educationLevel: z.string(),
          educationBackground: z.string(),
          primaryGoal: z.string(),
          weeklyHours: z.number(),
          knownTopics: z.array(z.string()),
          interests: z.array(z.string()),
          explanationDepth: z.enum(EXPLANATION_DEPTHS),
          challengeLevel: z.enum(CHALLENGE_LEVELS),
          tutorCharacter: z.enum(TUTOR_CHARACTERS),
          correctionStyle: z.enum(CORRECTION_STYLES),
          personaPreferenceNotes: z.array(z.string())
        })
      });

      extracted = {
        displayName: ensureString(parsed.displayName, "Learner"),
        educationLevel: ensureString(parsed.educationLevel, "Unknown"),
        educationBackground: ensureString(parsed.educationBackground, "Not shared yet"),
        primaryGoal: ensureString(
          parsed.primaryGoal,
          "Build stronger fundamentals through self-paced study."
        ),
        weeklyHours:
          typeof parsed.weeklyHours === "number" &&
          Number.isFinite(parsed.weeklyHours) &&
          parsed.weeklyHours >= 1 &&
          parsed.weeklyHours <= 80
            ? Math.round(parsed.weeklyHours)
            : 5,
        knownTopics: ensureStringList(parsed.knownTopics),
        interests: ensureStringList(parsed.interests),
        explanationDepth: normalizeEnum(
          parsed.explanationDepth,
          EXPLANATION_DEPTHS,
          "deep"
        ) as ExplanationDepth,
        challengeLevel: normalizeEnum(
          parsed.challengeLevel,
          CHALLENGE_LEVELS,
          "balanced"
        ) as ChallengeLevel,
        tutorCharacter: normalizeEnum(
          parsed.tutorCharacter,
          TUTOR_CHARACTERS,
          "supportive-coach"
        ) as TutorCharacter,
        correctionStyle: normalizeEnum(
          parsed.correctionStyle,
          CORRECTION_STYLES,
          "mixed"
        ) as CorrectionStyle,
        personaPreferenceNotes: ensureStringList(parsed.personaPreferenceNotes)
      };
    } catch {
      extracted = fallbackExtraction(cleanMessages);
    }
  }

  const docs = await applyOnboardingAnswers(userId, extracted);

  return {
    answers: extracted,
    docs
  };
}

// ---------------------------------------------------------------------------
// Progressive extraction — called as a side effect during conversation
// ---------------------------------------------------------------------------

export async function extractProgressiveUpdate(
  userId: string,
  messages: ConversationMessage[]
): Promise<void> {
  const cleanMessages = normalizeMessages(messages);
  const userMessages = cleanMessages.filter((m) => m.role === "user");

  // Not enough signal yet
  if (userMessages.length < 2) {
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    return;
  }

  const systemPrompt = [
    "Extract whatever you can about this learner from the conversation so far.",
    "Return ONLY the fields you are confident about. Use null for anything unknown.",
    "",
    "For enum fields, map naturally from conversation:",
    "- tutorCharacter: supportive-coach | strict-professor | calm-mentor | energetic-guide",
    "- correctionStyle: direct | socratic | mixed",
    "- explanationDepth: concise | deep",
    "- challengeLevel: easy | balanced | stretch",
    "",
    "Only set a field if the student clearly indicated it. Use null otherwise."
  ].join("\n");

  const userPrompt = [
    "Conversation so far:",
    transcriptString(cleanMessages) || "(empty)"
  ].join("\n");

  try {
    const { object: parsed } = await generateObject({
      model: getModel(),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      schema: z.object({
        displayName: z.string().nullable().optional(),
        educationLevel: z.string().nullable().optional(),
        educationBackground: z.string().nullable().optional(),
        primaryGoal: z.string().nullable().optional(),
        weeklyHours: z.number().nullable().optional(),
        knownTopics: z.array(z.string()).nullable().optional(),
        interests: z.array(z.string()).nullable().optional(),
        explanationDepth: z.enum(EXPLANATION_DEPTHS).nullable().optional(),
        challengeLevel: z.enum(CHALLENGE_LEVELS).nullable().optional(),
        tutorCharacter: z.enum(TUTOR_CHARACTERS).nullable().optional(),
        correctionStyle: z.enum(CORRECTION_STYLES).nullable().optional(),
        personaPreferenceNotes: z.array(z.string()).nullable().optional()
      })
    });

    // Filter out null values
    const cleaned: PartialOnboardingAnswers = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== null && value !== undefined) {
        (cleaned as Record<string, unknown>)[key] = value;
      }
    }

    if (Object.keys(cleaned).length > 0) {
      await applyPartialOnboardingUpdate(userId, cleaned);
    }
  } catch {
    // Non-critical — silently ignore failures
  }
}
