import {
  applyOnboardingAnswers,
  CHALLENGE_LEVELS,
  CORRECTION_STYLES,
  EXPLANATION_DEPTHS,
  TUTOR_CHARACTERS,
  type ChallengeLevel,
  type CorrectionStyle,
  type ExplanationDepth,
  type OnboardingAnswers,
  type TutorCharacter
} from "@/lib/state/onboarding";

export type ConversationMessage = {
  role: "assistant" | "user";
  content: string;
};

type NextQuestionPayload = {
  question: string;
  readyToFinalize: boolean;
  knownGaps: string[];
};

function normalizeContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((chunk) => {
        if (!chunk || typeof chunk !== "object") {
          return "";
        }
        const value = (chunk as { text?: unknown }).text;
        return typeof value === "string" ? value : "";
      })
      .join("\n");
  }

  return "";
}

function parseJsonContent<T>(raw: string): T | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (!fencedMatch) {
      return null;
    }
    try {
      return JSON.parse(fencedMatch[1]) as T;
    } catch {
      return null;
    }
  }
}

async function callOpenAIJson<T>(messages: Array<{ role: "system" | "user"; content: string }>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is missing.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      messages,
      response_format: { type: "json_object" },
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${details}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: unknown;
      };
    }>;
  };

  const content = normalizeContent(payload.choices?.[0]?.message?.content);
  const parsed = parseJsonContent<T>(content);
  if (!parsed) {
    throw new Error("Failed to parse JSON from model response.");
  }

  return parsed;
}

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
    "What is your education background? Include high school, AA/AS, BA/BS, or any other programs and where you completed them.",
    "What is your main learning goal right now, and how many hours per week can you commit?",
    "What topics do you already feel comfortable with, and which interests or hobbies should I use in examples?",
    "What tutor character do you want (supportive coach, strict professor, calm mentor, energetic guide), and do you prefer direct correction, Socratic guidance, or mixed style? Share any personality tweaks too (for example: blunt, playful, no fluff).",
    "Do you prefer concise explanations or deeper walkthroughs, and should question difficulty feel easy, balanced, or stretch?"
  ];

  const nextIndex = Math.min(userAnswers.length, steps.length - 1);
  const ready = userAnswers.length >= steps.length;

  return {
    question: ready
      ? "I have enough to personalize your tutor. Add anything else important, or type that you are done."
      : steps[nextIndex],
    readyToFinalize: ready,
    knownGaps: ready ? [] : ["Collecting required profile fields from onboarding chat"]
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
    "You are Book Quest's onboarding agent.",
    "Given the learner conversation, ask exactly one best next question.",
    "Adapt based on prior answers and ask follow-ups only if information is missing or vague.",
    "The onboarding needs these fields:",
    "- education background details",
    "- primary learning goal",
    "- weekly available hours",
    "- known topics",
    "- interests/hobbies for examples",
    "- tutor character (supportive-coach|strict-professor|calm-mentor|energetic-guide)",
    "- correction style (direct|socratic|mixed)",
    "- explanation depth (concise|deep)",
    "- challenge level (easy|balanced|stretch)",
    "Return JSON only with keys: question, readyToFinalize, knownGaps."
  ].join("\n");

  const userPrompt = [
    "Conversation transcript:",
    transcriptString(cleanMessages) || "(empty)",
    "",
    "If enough info exists, set readyToFinalize=true and ask a final optional catch-all question.",
    "knownGaps should be a short list of missing or weakly known fields."
  ].join("\n");

  try {
    const response = await callOpenAIJson<NextQuestionPayload>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]);

    return {
      question: ensureString(response.question, fallbackNextQuestion(cleanMessages).question),
      readyToFinalize: Boolean(response.readyToFinalize),
      knownGaps: ensureStringList(response.knownGaps)
    };
  } catch {
    return fallbackNextQuestion(cleanMessages);
  }
}

type ExtractionPayload = {
  displayName?: string;
  educationLevel?: string;
  educationBackground?: string;
  primaryGoal?: string;
  weeklyHours?: number;
  knownTopics?: string[];
  interests?: string[];
  explanationDepth?: string;
  challengeLevel?: string;
  tutorCharacter?: string;
  correctionStyle?: string;
  personaPreferenceNotes?: string[];
};

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
      "Map conversation into JSON only with keys:",
      "displayName, educationLevel, educationBackground, primaryGoal, weeklyHours, knownTopics, interests, explanationDepth, challengeLevel, tutorCharacter, correctionStyle, personaPreferenceNotes.",
      "Enum constraints:",
      `explanationDepth: ${EXPLANATION_DEPTHS.join("|")}`,
      `challengeLevel: ${CHALLENGE_LEVELS.join("|")}`,
      `tutorCharacter: ${TUTOR_CHARACTERS.join("|")}`,
      `correctionStyle: ${CORRECTION_STYLES.join("|")}`,
      "personaPreferenceNotes should be a short list of explicit tutor personality requests from the learner.",
      "If unknown, choose sensible defaults, but preserve user-provided detail in educationBackground."
    ].join("\n");

    const userPrompt = ["Conversation transcript:", transcriptString(cleanMessages) || "(empty)"].join(
      "\n"
    );

    try {
      const parsed = await callOpenAIJson<ExtractionPayload>([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]);

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
