import { NextRequest, NextResponse } from "next/server";

import {
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
  if (!tokens.length) {
    return [message];
  }

  const chunks: string[] = [];
  let current = "";

  for (const token of tokens) {
    if ((current + token).length > 28 && current) {
      chunks.push(current);
      current = token;
      continue;
    }
    current += token;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function toSseEvent(event: string, payload: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function streamNextResponse(next: Awaited<ReturnType<typeof generateNextOnboardingQuestion>>) {
  const chunks = chunkMessageForStream(next.question);
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, payload: unknown) => {
        controller.enqueue(encoder.encode(toSseEvent(event, payload)));
      };

      let index = 0;

      const pushChunk = () => {
        if (index >= chunks.length) {
          send("done", {
            assistantMessage: next.question,
            readyToFinalize: next.readyToFinalize,
            knownGaps: next.knownGaps
          });
          controller.close();
          return;
        }

        send("delta", { chunk: chunks[index] });
        index += 1;
        timer = setTimeout(pushChunk, 30);
      };

      send("meta", {
        readyToFinalize: next.readyToFinalize,
        knownGaps: next.knownGaps
      });
      pushChunk();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
      }
    }
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
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

    const next = await generateNextOnboardingQuestion(messages);
    if (mode === "next" && stream) {
      return streamNextResponse(next);
    }

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
