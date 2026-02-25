import { NextRequest, NextResponse } from "next/server";

import {
  generateNextCourseQuestion,
  generateCoursePlan,
  finalizeCoursePlan,
  editCoursePlan,
  type ConversationMessage
} from "@/lib/ai/courseCreationAgent";
import type { BookAnalysis } from "@/lib/pdf/analyzeBook";
import type { CoursePlan } from "@/lib/state/courseFiles";
import { readExtractedText } from "@/lib/state/courseFiles";

type AgentRequestBody = {
  mode?: "next" | "generate-plan" | "finalize" | "edit-plan";
  stream?: boolean;
  userId?: string;
  messages?: ConversationMessage[];
  bookAnalysis?: BookAnalysis | null;
  courseId?: string;
  coursePlan?: CoursePlan;
  currentPlan?: CoursePlan;
  editInstruction?: string;
};

function isValidMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== "object") return false;
  const input = value as { role?: unknown; content?: unknown };
  return (
    (input.role === "assistant" || input.role === "user") &&
    typeof input.content === "string" &&
    input.content.trim().length > 0
  );
}

function chunkMessageForStream(message: string) {
  const tokens = message.match(/\S+\s*/g) ?? [];
  return tokens.length ? tokens : [message];
}

function toSseEvent(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function streamNextResponse(
  nextPromise: Promise<Awaited<ReturnType<typeof generateNextCourseQuestion>>>
) {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(toSseEvent(event, payload)));
      };

      send("meta", { status: "started" });

      const run = async () => {
        const next = await nextPromise;
        const chunks = chunkMessageForStream(next.question);

        if (cancelled) return;

        send("meta", {
          readyToGenerate: next.readyToGenerate,
          knownGaps: next.knownGaps,
          requestingUpload: next.requestingUpload
        });

        for (const chunk of chunks) {
          if (cancelled) return;
          send("delta", { chunk });
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 45);
          });
        }

        if (cancelled) return;

        send("done", {
          assistantMessage: next.question,
          readyToGenerate: next.readyToGenerate,
          knownGaps: next.knownGaps,
          requestingUpload: next.requestingUpload
        });
        controller.close();
      };

      run().catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Unexpected course agent error.";
        send("error", { message });
        controller.close();
      });
    },
    cancel() {
      cancelled = true;
      if (timer) clearTimeout(timer);
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as AgentRequestBody | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
    }

    const mode = body.mode ?? "next";
    const stream = body.stream === true;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    const messages = Array.isArray(body.messages) ? body.messages.filter(isValidMessage) : [];
    const bookAnalysis = body.bookAnalysis ?? null;

    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    // Mode: edit-plan
    if (mode === "edit-plan") {
      const currentPlan = body.currentPlan;
      const editInstruction = typeof body.editInstruction === "string" ? body.editInstruction.trim() : "";
      const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";

      if (!currentPlan || !editInstruction || !bookAnalysis) {
        return NextResponse.json(
          { error: "currentPlan, editInstruction, and bookAnalysis are required for edit-plan." },
          { status: 400 }
        );
      }

      const extractedPages = courseId ? await readExtractedText(userId, courseId) : null;

      const result = await editCoursePlan({
        currentPlan,
        userInstruction: editInstruction,
        bookAnalysis,
        messages,
        userId,
        extractedPages
      });

      return NextResponse.json({
        mode,
        plan: result.updatedPlan,
        bookAnalysis: result.updatedBookAnalysis ?? null,
        explanation: result.explanation
      });
    }

    // Mode: generate-plan
    if (mode === "generate-plan") {
      if (!bookAnalysis) {
        return NextResponse.json(
          { error: "bookAnalysis is required for plan generation." },
          { status: 400 }
        );
      }
      const plan = await generateCoursePlan(messages, bookAnalysis, userId);
      return NextResponse.json({ mode, plan });
    }

    // Mode: finalize
    if (mode === "finalize") {
      const courseId = typeof body.courseId === "string" ? body.courseId.trim() : "";
      const coursePlan = body.coursePlan;
      if (!courseId || !coursePlan) {
        return NextResponse.json(
          { error: "courseId and coursePlan are required for finalization." },
          { status: 400 }
        );
      }
      const result = await finalizeCoursePlan(userId, courseId, coursePlan);
      return NextResponse.json({ mode, ...result });
    }

    // Mode: next
    if (mode === "next" && stream) {
      return streamNextResponse(
        generateNextCourseQuestion(messages, bookAnalysis, userId)
      );
    }

    const next = await generateNextCourseQuestion(messages, bookAnalysis, userId);
    return NextResponse.json({
      mode,
      assistantMessage: next.question,
      readyToGenerate: next.readyToGenerate,
      knownGaps: next.knownGaps,
      requestingUpload: next.requestingUpload
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected course agent error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
