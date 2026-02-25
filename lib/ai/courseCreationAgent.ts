import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "./model";
import { readUserStateDoc } from "@/lib/state/userState";
import { saveCoursePlan, type CoursePlan } from "@/lib/state/courseFiles";
import type { BookAnalysis } from "@/lib/pdf/analyzeBook";

export type ConversationMessage = {
  role: "assistant" | "user";
  content: string;
};

type NextQuestionPayload = {
  question: string;
  readyToGenerate: boolean;
  knownGaps: string[];
  requestingUpload: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function transcriptString(messages: ConversationMessage[]) {
  return messages
    .filter((m) => m.content.trim().length > 0)
    .map((m) => `${m.role.toUpperCase()}: ${m.content.trim()}`)
    .join("\n");
}

async function loadUserStateDocs(userId: string) {
  const [profile, preferences, persona, memory] = await Promise.all([
    readUserStateDoc(userId, "PROFILE"),
    readUserStateDoc(userId, "PREFERENCES"),
    readUserStateDoc(userId, "TUTOR_PERSONA"),
    readUserStateDoc(userId, "MEMORY")
  ]);
  return { profile, preferences, persona, memory };
}

function compactBookSummary(analysis: BookAnalysis): string {
  const chapterLines = analysis.chapters.map(
    (ch) =>
      `Ch${ch.chapterNumber} "${ch.title}" (pp.${ch.startPage + 1}-${ch.endPage + 1}): ${ch.summary} | Concepts: ${ch.keyConcepts.join(", ")}`
  );
  return [
    `Book: "${analysis.title}"${analysis.author ? ` by ${analysis.author}` : ""}`,
    `Pages: ${analysis.totalPages} | Chapters: ${analysis.chapters.length} | Detection: ${analysis.detectionMethod}`,
    "",
    ...chapterLines
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Fallback question sequence (no API key)
// ---------------------------------------------------------------------------

function fallbackNextQuestion(
  messages: ConversationMessage[],
  hasBook: boolean
): NextQuestionPayload {
  const userAnswers = messages.filter((m) => m.role === "user");
  const count = userAnswers.length;

  if (!hasBook) {
    const preUploadSteps = [
      "Hey! I'm ready to help you build a personalized course. What subject or topic are you looking to study, and what's motivating you to learn it?",
      "That's great context! Now, share your materials with me — drop a PDF of your textbook or study material right here in the chat, and I'll read through it."
    ];
    const idx = Math.min(count, preUploadSteps.length - 1);
    return {
      question: preUploadSteps[idx],
      readyToGenerate: false,
      knownGaps: ["Waiting for PDF upload"],
      requestingUpload: count >= 1
    };
  }

  const postUploadSteps = [
    "I've finished reading your book! Based on what I see, this covers a lot of ground. Are there specific chapters or topics you want to focus on, or areas you'd like to skip?",
    "Got it! How deep do you want to go — a high-level overview of the whole book, or a deep dive into specific sections? And roughly how many hours per week can you dedicate to this course?",
    "This is really helpful. Any topics you already feel confident about that we can move through quickly? Or areas where you know you'll need extra practice?"
  ];
  const idx = Math.min(count - 2, postUploadSteps.length - 1);
  const ready = count >= 5;

  return {
    question: ready
      ? "I think I have a solid understanding of what you need. Ready for me to generate your course plan?"
      : postUploadSteps[Math.max(0, idx)],
    readyToGenerate: ready,
    knownGaps: ready ? [] : ["Your learning priorities and depth preferences"],
    requestingUpload: false
  };
}

// ---------------------------------------------------------------------------
// Generate next course question
// ---------------------------------------------------------------------------

export async function generateNextCourseQuestion(
  messages: ConversationMessage[],
  bookAnalysis: BookAnalysis | null,
  userId: string
): Promise<NextQuestionPayload> {
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (!hasApiKey) {
    return fallbackNextQuestion(messages, bookAnalysis !== null);
  }

  const docs = await loadUserStateDocs(userId);

  const bookContext = bookAnalysis
    ? `\n\nYou have already read their book. Here is your analysis:\n${compactBookSummary(bookAnalysis)}`
    : "\n\nThe learner has NOT yet uploaded their study materials.";

  const systemPrompt = [
    "You ARE the learner's Book Quest tutor, helping them create a personalized course.",
    `Tutor persona:\n${docs.persona.content}`,
    "",
    `Learner profile:\n${docs.profile.content}`,
    "",
    `Learning preferences:\n${docs.preferences.content}`,
    "",
    "Rules:",
    "- Speak like a real person — warm, encouraging, and conversational.",
    "- Ask exactly ONE question (or a closely related pair) per turn.",
    "- Adapt based on what the learner has already shared.",
    "",
    bookAnalysis
      ? "POST-UPLOAD PHASE: You've read the book. Reference specific chapters and topics. Ask about depth, priorities, topics to skip, familiarity, and structure preferences."
      : "PRE-UPLOAD PHASE: Ask about their learning goals, motivation, and background. Then ask them to upload their PDF materials.",
    bookContext
  ].join("\n");

  const userPrompt = [
    "Conversation transcript:",
    transcriptString(messages) || "(empty)",
    "",
    bookAnalysis
      ? "Determine if you have enough context to generate a course plan. Set readyToGenerate=true only after ~3-4 post-upload exchanges where you understand their priorities."
      : "You need them to upload a PDF. Set requestingUpload=true when it's time to ask for materials.",
    "knownGaps: short list of what you still need to know, in second person."
  ].join("\n");

  try {
    const { object: response } = await generateObject({
      model: getModel(),
      system: systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
      schema: z.object({
        question: z.string(),
        readyToGenerate: z.boolean(),
        knownGaps: z.array(z.string()),
        requestingUpload: z.boolean()
      })
    });

    return {
      question: response.question || fallbackNextQuestion(messages, bookAnalysis !== null).question,
      readyToGenerate: Boolean(response.readyToGenerate),
      knownGaps: Array.isArray(response.knownGaps)
        ? response.knownGaps.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
        : [],
      requestingUpload: Boolean(response.requestingUpload)
    };
  } catch {
    return fallbackNextQuestion(messages, bookAnalysis !== null);
  }
}

// ---------------------------------------------------------------------------
// Generate course plan
// ---------------------------------------------------------------------------

export async function generateCoursePlan(
  messages: ConversationMessage[],
  bookAnalysis: BookAnalysis,
  userId: string
): Promise<CoursePlan> {
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);
  const docs = await loadUserStateDocs(userId);

  if (!hasApiKey) {
    // Fallback: one unit per chapter
    return {
      title: `Course: ${bookAnalysis.title}`,
      description: `A personalized course based on "${bookAnalysis.title}".`,
      estimatedHours: Math.round(
        bookAnalysis.chapters.reduce((sum, ch) => sum + ch.estimatedReadingMinutes, 0) / 60
      ),
      units: bookAnalysis.chapters.map((ch) => ({
        unitNumber: ch.chapterNumber,
        title: ch.title,
        summary: ch.summary,
        objectives: ch.learningObjectives,
        sourceChapters: [ch.chapterNumber],
        estimatedMinutes: ch.estimatedReadingMinutes
      }))
    };
  }

  const systemPrompt = [
    "You create structured course plans from book analyses and learner conversations.",
    `Learner profile:\n${docs.profile.content}`,
    `Learning preferences:\n${docs.preferences.content}`,
    "",
    "Create a course plan that:",
    "- Groups related chapters into logical units",
    "- Respects the learner's stated priorities and depth preferences",
    "- Skips or condenses topics they already know",
    "- Maps each unit to source chapters from the book",
    "- Provides realistic time estimates"
  ].join("\n");

  const userPrompt = [
    `Book analysis:\n${compactBookSummary(bookAnalysis)}`,
    "",
    `Conversation transcript:\n${transcriptString(messages)}`,
    "",
    "Generate a structured course plan based on this book and the learner's preferences."
  ].join("\n");

  const { object: plan } = await generateObject({
    model: getModel(),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.3,
    schema: z.object({
      title: z.string(),
      description: z.string(),
      estimatedHours: z.number(),
      units: z.array(
        z.object({
          unitNumber: z.number(),
          title: z.string(),
          summary: z.string(),
          objectives: z.array(z.string()),
          sourceChapters: z.array(z.number()),
          estimatedMinutes: z.number()
        })
      )
    })
  });

  return plan;
}

// ---------------------------------------------------------------------------
// Edit course plan
// ---------------------------------------------------------------------------

export type EditPlanResult = {
  updatedPlan: CoursePlan;
  updatedBookAnalysis?: BookAnalysis;
  explanation: string;
};

export async function editCoursePlan(opts: {
  currentPlan: CoursePlan;
  userInstruction: string;
  bookAnalysis: BookAnalysis;
  messages: ConversationMessage[];
  userId: string;
  extractedPages?: string[] | null;
}): Promise<EditPlanResult> {
  const { currentPlan, userInstruction, bookAnalysis, messages, userId, extractedPages } = opts;
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);

  if (!hasApiKey) {
    return {
      updatedPlan: currentPlan,
      explanation: "No API key configured — unable to edit the plan automatically."
    };
  }

  const docs = await loadUserStateDocs(userId);
  const looksLikeMissingContent =
    /miss|last chapter|missing|forgot|left out|not included|cut off|incomplete/i.test(userInstruction);

  // If the user reports missing content AND we have raw pages, do a two-step flow
  if (looksLikeMissingContent && extractedPages?.length) {
    const lastChapter = bookAnalysis.chapters[bookAnalysis.chapters.length - 1];
    const lastDetectedPage = lastChapter ? lastChapter.endPage : 0;
    const totalPages = bookAnalysis.totalPages;

    if (lastDetectedPage < totalPages - 1) {
      // There are uncovered pages — ask the LLM to identify what's there
      const uncoveredText = extractedPages
        .slice(lastDetectedPage + 1)
        .join("\n---PAGE BREAK---\n")
        .slice(0, 12000); // cap to avoid token overflow

      const { object: discovery } = await generateObject({
        model: getModel(),
        system: [
          "You are analyzing pages from a book that were not covered by the initial chapter detection.",
          `The book has ${totalPages} pages. The last detected chapter ends at page ${lastDetectedPage + 1}.`,
          `Pages ${lastDetectedPage + 2} through ${totalPages} were not included in any chapter.`,
          "Identify the chapter(s) present in these pages."
        ].join("\n"),
        prompt: [
          "Uncovered page text:",
          uncoveredText,
          "",
          "Identify the chapter title, a brief summary, key concepts, learning objectives, and the approximate page range."
        ].join("\n"),
        temperature: 0.2,
        schema: z.object({
          chapters: z.array(
            z.object({
              title: z.string(),
              summary: z.string(),
              keyConcepts: z.array(z.string()),
              learningObjectives: z.array(z.string()),
              startPage: z.number().describe("0-indexed start page"),
              endPage: z.number().describe("0-indexed end page")
            })
          )
        })
      });

      // Build updated book analysis with newly discovered chapters
      const updatedBookAnalysis: BookAnalysis = {
        ...bookAnalysis,
        chapters: [
          ...bookAnalysis.chapters,
          ...discovery.chapters.map((ch, i) => ({
            chapterNumber: bookAnalysis.chapters.length + i + 1,
            title: ch.title,
            startPage: ch.startPage,
            endPage: ch.endPage,
            summary: ch.summary,
            keyConcepts: ch.keyConcepts,
            learningObjectives: ch.learningObjectives,
            prerequisites: [] as string[],
            estimatedReadingMinutes: Math.round(
              ((ch.endPage - ch.startPage + 1) / totalPages) * 120
            )
          }))
        ]
      };

      // Now update the plan to incorporate the new chapters
      const { object: editedPlan } = await generateObject({
        model: getModel(),
        system: [
          "You edit course plans. The user reported missing content. New chapters have been discovered.",
          `Learner profile:\n${docs.profile.content}`,
          `Learning preferences:\n${docs.preferences.content}`,
          "",
          "Add units for the newly discovered chapters. Preserve all existing units exactly as they are.",
          "Renumber units if needed so they are sequential."
        ].join("\n"),
        prompt: [
          `User instruction: "${userInstruction}"`,
          "",
          `Current plan:\n${JSON.stringify(currentPlan, null, 2)}`,
          "",
          `Newly discovered chapters:\n${JSON.stringify(discovery.chapters, null, 2)}`,
          "",
          "Return the full updated plan with new units added, plus a short explanation of what changed."
        ].join("\n"),
        temperature: 0.2,
        schema: z.object({
          title: z.string(),
          description: z.string(),
          estimatedHours: z.number(),
          units: z.array(
            z.object({
              unitNumber: z.number(),
              title: z.string(),
              summary: z.string(),
              objectives: z.array(z.string()),
              sourceChapters: z.array(z.number()),
              estimatedMinutes: z.number()
            })
          ),
          explanation: z.string()
        })
      });

      return {
        updatedPlan: {
          title: editedPlan.title,
          description: editedPlan.description,
          estimatedHours: editedPlan.estimatedHours,
          units: editedPlan.units
        },
        updatedBookAnalysis,
        explanation: editedPlan.explanation
      };
    }
  }

  // Standard edit: single generateObject call
  const { object: editedPlan } = await generateObject({
    model: getModel(),
    system: [
      "You edit course plans based on user instructions.",
      `Learner profile:\n${docs.profile.content}`,
      `Learning preferences:\n${docs.preferences.content}`,
      "",
      "Rules:",
      "- Make ONLY the requested changes. Preserve everything else exactly.",
      "- Keep unit numbers sequential.",
      "- If splitting a unit, create two new units with appropriate content.",
      "- If removing a unit, renumber the remaining units.",
      "- Provide a short explanation of what you changed."
    ].join("\n"),
    prompt: [
      `User instruction: "${userInstruction}"`,
      "",
      `Current plan:\n${JSON.stringify(currentPlan, null, 2)}`,
      "",
      `Book analysis summary:\n${compactBookSummary(bookAnalysis)}`,
      "",
      "Return the full updated plan with the requested changes applied."
    ].join("\n"),
    temperature: 0.2,
    schema: z.object({
      title: z.string(),
      description: z.string(),
      estimatedHours: z.number(),
      units: z.array(
        z.object({
          unitNumber: z.number(),
          title: z.string(),
          summary: z.string(),
          objectives: z.array(z.string()),
          sourceChapters: z.array(z.number()),
          estimatedMinutes: z.number()
        })
      ),
      explanation: z.string()
    })
  });

  return {
    updatedPlan: {
      title: editedPlan.title,
      description: editedPlan.description,
      estimatedHours: editedPlan.estimatedHours,
      units: editedPlan.units
    },
    explanation: editedPlan.explanation
  };
}

// ---------------------------------------------------------------------------
// Finalize course plan
// ---------------------------------------------------------------------------

export async function finalizeCoursePlan(
  userId: string,
  courseId: string,
  plan: CoursePlan
) {
  return saveCoursePlan(userId, courseId, plan);
}
