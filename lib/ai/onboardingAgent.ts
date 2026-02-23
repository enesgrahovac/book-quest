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
      model: process.env.OPENAI_MODEL ?? "gpt-5.2",
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
    "Hey there! I'm your Book Quest tutor — excited to meet you! What's your name, and can you tell me a bit about your education background? Like, where you went to school or what you've studied so far.",
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
    "- Whether practice questions should feel comfortable, just right, or challenging",
    "",
    "Return JSON only with keys: question, readyToFinalize, knownGaps.",
    "question = your next conversational message (as the tutor, in first person).",
    "readyToFinalize = true only when all areas above are reasonably covered.",
    "knownGaps = short, friendly list of what you still want to learn about the student.",
    "Write each gap in second person (e.g. 'Your learning goals' not 'What they want to learn')."
  ].join("\n");

  const userPrompt = [
    "Conversation transcript:",
    transcriptString(cleanMessages) || "(empty)",
    "",
    "If enough info exists, set readyToFinalize=true and ask a final optional catch-all question.",
    "knownGaps should be a short, friendly list of what's still missing, written in second person (addressing 'you')."
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
    "Return JSON with ONLY the fields you are confident about. Use null for anything unknown.",
    "Keys: displayName, educationLevel, educationBackground, primaryGoal, weeklyHours,",
    "knownTopics (string[]), interests (string[]), explanationDepth, challengeLevel,",
    "tutorCharacter, correctionStyle, personaPreferenceNotes (string[]).",
    "",
    "For enum fields, map naturally from conversation:",
    "- tutorCharacter: supportive-coach | strict-professor | calm-mentor | energetic-guide",
    "- correctionStyle: direct | socratic | mixed",
    "- explanationDepth: concise | deep",
    "- challengeLevel: easy | balanced | stretch",
    "",
    "Only set a field if the student clearly indicated it. Omit or null otherwise."
  ].join("\n");

  const userPrompt = [
    "Conversation so far:",
    transcriptString(cleanMessages) || "(empty)"
  ].join("\n");

  try {
    const parsed = await callOpenAIJson<PartialOnboardingAnswers>([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]);

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
