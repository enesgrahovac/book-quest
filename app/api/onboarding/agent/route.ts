import { NextRequest, NextResponse } from "next/server";

import {
  extractProgressiveUpdate,
  finalizeOnboardingFromConversation,
  generateNextOnboardingQuestion,
  type ConversationMessage
} from "@/lib/ai/onboardingAgent";

type AgentRequestBody = {
  mode?: "next" | "finalize";
  stream?: boolean;
  userId?: string;
  messages?: ConversationMessage[];
};

function isValidMessage(value: unknown): value is ConversationMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
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
  nextPromise: Promise<Awaited<ReturnType<typeof generateNextOnboardingQuestion>>>
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

        if (cancelled) {
          return;
        }

        send("meta", {
          readyToFinalize: next.readyToFinalize,
          knownGaps: next.knownGaps
        });

        for (const chunk of chunks) {
          if (cancelled) {
            return;
          }

          send("delta", { chunk });
          await new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 45);
          });
        }

        if (cancelled) {
          return;
        }

        send("done", {
          assistantMessage: next.question,
          readyToFinalize: next.readyToFinalize,
          knownGaps: next.knownGaps
        });
        controller.close();
      };

      run().catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unexpected onboarding error.";
        send("error", { message });
        controller.close();
      });
    },
    cancel() {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
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

    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    if (mode === "finalize") {
      const result = await finalizeOnboardingFromConversation(userId, messages);
      return NextResponse.json({
        mode,
        userId,
        answers: result.answers,
        updatedDocs: result.docs.map((doc) => ({ key: doc.key, updatedAt: doc.updatedAt }))
      });
    }

    if (mode === "next") {
      // Fire-and-forget: progressively extract and persist partial persona
      extractProgressiveUpdate(userId, messages).catch(() => {});
    }

    if (mode === "next" && stream) {
      return streamNextResponse(generateNextOnboardingQuestion(messages));
    }

    const next = await generateNextOnboardingQuestion(messages);
    return NextResponse.json({
      mode,
      assistantMessage: next.question,
      readyToFinalize: next.readyToFinalize,
      knownGaps: next.knownGaps
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected onboarding error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
