import { NextRequest, NextResponse } from "next/server";

import {
  CHALLENGE_LEVELS,
  CORRECTION_STYLES,
  EXPLANATION_DEPTHS,
  TUTOR_CHARACTERS,
  applyOnboardingAnswers,
  type ChallengeLevel,
  type CorrectionStyle,
  type ExplanationDepth,
  type OnboardingAnswers,
  type TutorCharacter
} from "@/lib/state/onboarding";

type RouteParams = {
  params: {
    userId: string;
  };
};

function toCleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isInList<T extends readonly string[]>(value: string, list: T): value is T[number] {
  return list.includes(value);
}

function parseAnswers(body: unknown): { answers: OnboardingAnswers | null; error: string | null } {
  if (!body || typeof body !== "object") {
    return { answers: null, error: "Body must be a JSON object." };
  }

  const input = body as Record<string, unknown>;
  const displayName = toCleanString(input.displayName);
  const educationLevel = toCleanString(input.educationLevel);
  const primaryGoal = toCleanString(input.primaryGoal);
  const weeklyHoursRaw = Number(input.weeklyHours);
  const knownTopics = toStringList(input.knownTopics);
  const interests = toStringList(input.interests);
  const explanationDepthRaw = toCleanString(input.explanationDepth);
  const challengeLevelRaw = toCleanString(input.challengeLevel);
  const tutorCharacterRaw = toCleanString(input.tutorCharacter);
  const correctionStyleRaw = toCleanString(input.correctionStyle);
  const personaPreferenceNotes = toStringList(input.personaPreferenceNotes);

  if (!displayName) {
    return { answers: null, error: "displayName is required." };
  }
  if (!educationLevel) {
    return { answers: null, error: "educationLevel is required." };
  }
  if (!primaryGoal) {
    return { answers: null, error: "primaryGoal is required." };
  }
  if (!Number.isFinite(weeklyHoursRaw) || weeklyHoursRaw < 1 || weeklyHoursRaw > 80) {
    return { answers: null, error: "weeklyHours must be between 1 and 80." };
  }
  if (!isInList(explanationDepthRaw, EXPLANATION_DEPTHS)) {
    return { answers: null, error: "Invalid explanationDepth value." };
  }
  if (!isInList(challengeLevelRaw, CHALLENGE_LEVELS)) {
    return { answers: null, error: "Invalid challengeLevel value." };
  }
  if (!isInList(tutorCharacterRaw, TUTOR_CHARACTERS)) {
    return { answers: null, error: "Invalid tutorCharacter value." };
  }
  if (!isInList(correctionStyleRaw, CORRECTION_STYLES)) {
    return { answers: null, error: "Invalid correctionStyle value." };
  }

  return {
    answers: {
      displayName,
      educationLevel,
      primaryGoal,
      weeklyHours: Math.round(weeklyHoursRaw),
      knownTopics,
      interests,
      explanationDepth: explanationDepthRaw as ExplanationDepth,
      challengeLevel: challengeLevelRaw as ChallengeLevel,
      tutorCharacter: tutorCharacterRaw as TutorCharacter,
      correctionStyle: correctionStyleRaw as CorrectionStyle,
      personaPreferenceNotes
    },
    error: null
  };
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const body = await request.json();
  const { answers, error } = parseAnswers(body);

  if (!answers) {
    return NextResponse.json({ error }, { status: 400 });
  }

  const docs = await applyOnboardingAnswers(params.userId, answers);

  return NextResponse.json({
    userId: params.userId,
    updatedDocs: docs.map((doc) => ({
      key: doc.key,
      updatedAt: doc.updatedAt
    }))
  });
}
