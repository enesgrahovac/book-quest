"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState, useMemo } from "react";

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

type AgentNextResponse = {
  assistantMessage: string;
  readyToFinalize: boolean;
  knownGaps: string[];
};

type AgentStreamDelta = {
  chunk?: string;
};

type FinalizeResponse = {
  userId: string;
  answers: {
    displayName: string;
    educationLevel: string;
    primaryGoal: string;
    weeklyHours: number;
  };
  updatedDocs: Array<{ key: string; updatedAt: string }>;
};

type NetworkState = "idle" | "loading";

// TODO: replace with auth session userId
const USER_ID = "local-learner";

function parseSseBlock(block: string) {
  const lines = block.split(/\r?\n/);
  let event = "";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!event || !dataLines.length) {
    return null;
  }

  return {
    event,
    data: dataLines.join("\n")
  };
}

function nextSseDelimiter(buffer: string) {
  const match = buffer.match(/\r?\n\r?\n/);
  if (!match || typeof match.index !== "number") {
    return null;
  }
  return {
    index: match.index,
    length: match[0].length
  };
}

export default function OnboardingPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [knownGaps, setKnownGaps] = useState<string[]>([]);
  const [readyToFinalize, setReadyToFinalize] = useState(false);
  const [networkState, setNetworkState] = useState<NetworkState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [finalResult, setFinalResult] = useState<FinalizeResponse | null>(null);
  const [modifierKeyLabel, setModifierKeyLabel] = useState<"Ctrl" | "Cmd">("Ctrl");

  const chatPanelRef = useRef<HTMLDivElement>(null);

  const hasConversation = messages.length > 0;
  const canSendAnswer =
    networkState === "idle" && hasConversation && draftAnswer.trim().length > 0 && !finalResult;
  const canFinalize =
    networkState === "idle" &&
    hasConversation &&
    !finalResult &&
    readyToFinalize &&
    messages.some((message) => message.role === "user");

  const endpoint = "/api/onboarding/agent";

  const summaryText = useMemo(() => {
    if (!finalResult) {
      return "";
    }
    return `${finalResult.answers.displayName} | ${finalResult.answers.educationLevel} | ${finalResult.answers.weeklyHours} hrs/week`;
  }, [finalResult]);

  // Auto-scroll to latest message
  useEffect(() => {
    const panel = chatPanelRef.current;
    if (panel) {
      panel.scrollTop = panel.scrollHeight;
    }
  }, [messages, networkState]);

  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) {
      setModifierKeyLabel("Cmd");
    }
  }, []);

  const appendAssistantDelta = useCallback((chunk: string) => {
    if (!chunk) {
      return;
    }

    setMessages((current) => {
      if (!current.length) {
        return [{ role: "assistant", content: chunk }];
      }

      const last = current[current.length - 1];
      if (last.role !== "assistant") {
        return [...current, { role: "assistant", content: chunk }];
      }

      const updated = [...current];
      updated[updated.length - 1] = {
        ...last,
        content: `${last.content}${chunk}`
      };
      return updated;
    });
  }, []);

  async function requestNextQuestionStream(
    conversation: ChatMessage[],
    onDelta: (chunk: string) => void
  ) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "next",
        stream: true,
        userId: USER_ID,
        messages: conversation
      })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "Failed to get next onboarding question.");
    }

    if (!response.body) {
      throw new Error("Streaming response was empty.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload: AgentNextResponse | null = null;
    let streamError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
      }

      let separator = nextSseDelimiter(buffer);
      while (separator) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        separator = nextSseDelimiter(buffer);

        const parsedBlock = parseSseBlock(block);
        if (!parsedBlock) {
          continue;
        }

        try {
          if (parsedBlock.event === "delta") {
            const payload = JSON.parse(parsedBlock.data) as AgentStreamDelta;
            if (typeof payload.chunk === "string") {
              onDelta(payload.chunk);
              // Yield to avoid React batching all coalesced deltas into one paint.
              await new Promise<void>((resolve) => {
                setTimeout(resolve, 0);
              });
            }
            continue;
          }

          if (parsedBlock.event === "meta") {
            const payload = JSON.parse(parsedBlock.data) as {
              readyToFinalize?: unknown;
              knownGaps?: unknown;
            };
            if (typeof payload.readyToFinalize === "boolean") {
              setReadyToFinalize(payload.readyToFinalize);
            }
            if (Array.isArray(payload.knownGaps)) {
              setKnownGaps(
                payload.knownGaps.filter((gap): gap is string => typeof gap === "string" && gap.trim().length > 0)
              );
            }
            continue;
          }

          if (parsedBlock.event === "error") {
            const payload = JSON.parse(parsedBlock.data) as { message?: unknown };
            streamError =
              typeof payload.message === "string" && payload.message.trim().length > 0
                ? payload.message
                : "Unexpected stream error.";
            continue;
          }

          if (parsedBlock.event === "done") {
            donePayload = JSON.parse(parsedBlock.data) as AgentNextResponse;
            continue;
          }
        } catch {
          continue;
        }
      }

      if (done) {
        break;
      }
    }

    if (streamError) {
      throw new Error(streamError);
    }

    if (!donePayload) {
      throw new Error("Tutor stream ended without a final payload.");
    }

    return donePayload;
  }

  async function startConversation() {
    setNetworkState("loading");
    setErrorMessage("");
    setFinalResult(null);
    setReadyToFinalize(false);
    setKnownGaps([]);

    try {
      setMessages([]);
      const next = await requestNextQuestionStream([], appendAssistantDelta);
      setMessages([{ role: "assistant", content: next.assistantMessage }]);
      setReadyToFinalize(next.readyToFinalize);
      setKnownGaps(next.knownGaps);
    } catch (error) {
      setMessages([]);
      setErrorMessage(error instanceof Error ? error.message : "Failed to start onboarding.");
    } finally {
      setNetworkState("idle");
    }
  }

  const sendAnswer = useCallback(async () => {
    if (!canSendAnswer) {
      return;
    }

    setNetworkState("loading");
    setErrorMessage("");
    const previousConversation = messages;
    const userMessage: ChatMessage = { role: "user", content: draftAnswer.trim() };
    const updatedConversation = [...previousConversation, userMessage];
    setMessages(updatedConversation);
    setDraftAnswer("");

    try {
      const next = await requestNextQuestionStream(updatedConversation, appendAssistantDelta);
      setMessages([...updatedConversation, { role: "assistant", content: next.assistantMessage }]);
      setReadyToFinalize(next.readyToFinalize);
      setKnownGaps(next.knownGaps);
    } catch (error) {
      setMessages(previousConversation);
      setDraftAnswer(userMessage.content);
      setErrorMessage(error instanceof Error ? error.message : "Could not process your answer.");
    } finally {
      setNetworkState("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendAssistantDelta, canSendAnswer, draftAnswer, messages]);

  function handleSendAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendAnswer();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendAnswer();
    }
  }

  async function finalizeOnboarding() {
    if (!canFinalize) {
      return;
    }

    setNetworkState("loading");
    setErrorMessage("");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "finalize",
        userId: USER_ID,
        messages
      })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setNetworkState("idle");
      setErrorMessage(data?.error ?? "Failed to finalize onboarding.");
      return;
    }

    const result = (await response.json()) as FinalizeResponse;
    setFinalResult(result);
    setNetworkState("idle");
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Getting Started</p>
        <h1>Let&apos;s get to know each other.</h1>
        <p>
          Have a quick chat with your tutor so I can personalize everything to how you learn best.
        </p>
        <div className="buttonRow">
          <button
            type="button"
            onClick={startConversation}
            disabled={networkState === "loading"}
          >
            {hasConversation ? "Start over" : "Say hello"}
          </button>
          <Link href="/" className="ghostLink">
            Back to home
          </Link>
        </div>
      </section>

      <section className="formCard">
        <div className="chatPanel" ref={chatPanelRef}>
          {messages.length === 0 && networkState === "idle" ? (
            <div className="chatEmptyState">
              <div className="chatEmptyIcon" aria-hidden="true">
                &#128218;
              </div>
              <p>
                Click <strong>&quot;Say hello&quot;</strong> above to start chatting with your tutor.
              </p>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                key={`${message.role}-${index}`}
                className={`chatMessage ${message.role === "assistant" ? "assistantBubble" : "userBubble"}`}
              >
                <p className="chatRole">
                  <span className="chatRoleIcon">{message.role === "assistant" ? "T" : "Y"}</span>
                  {message.role === "assistant" ? "Tutor" : "You"}
                </p>
                <p>{message.content}</p>
              </article>
            ))
          )}

          {networkState === "loading" && messages[messages.length - 1]?.role !== "assistant" ? (
            <div className="typingIndicator">
              <span className="chatRoleIcon" style={{ background: "var(--accent)" }}>T</span>
              <div className="typingDots">
                <span className="typingDot" />
                <span className="typingDot" />
                <span className="typingDot" />
              </div>
            </div>
          ) : null}
        </div>

        <form onSubmit={handleSendAnswer} className="answerComposer">
          <label>
            Your answer
            <textarea
              value={draftAnswer}
              onChange={(event) => setDraftAnswer(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              disabled={!hasConversation || networkState === "loading" || Boolean(finalResult)}
              placeholder="Type your response with as much detail as you want..."
            />
            <span className="keyboardHint">
              Press {modifierKeyLabel}+Enter to send
            </span>
          </label>
          <div className="buttonRow">
            <button type="submit" disabled={!canSendAnswer}>
              {networkState === "loading" ? "Thinking..." : "Send"}
            </button>
            {canFinalize ? (
              <button
                type="button"
                className="btnSecondary"
                onClick={finalizeOnboarding}
              >
                All done — set up my profile
              </button>
            ) : null}
          </div>
        </form>

        {knownGaps.length > 0 ? (
          <div className="knownGapsCard">
            <p>I&apos;d still love to know:</p>
            <ul>
              {knownGaps.map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {errorMessage ? <div className="errorBox">{errorMessage}</div> : null}

        {finalResult ? (
          <div className="successBox">
            <p>You&apos;re all set, <strong>{finalResult.answers.displayName}</strong>!</p>
            <p>{summaryText}</p>
            <ul>
              {finalResult.updatedDocs.map((doc) => (
                <li key={doc.key}>
                  {doc.key} updated at {new Date(doc.updatedAt).toLocaleString()}
                </li>
              ))}
            </ul>
            <Link href={`/state/${encodeURIComponent(finalResult.userId)}`} className="ctaLink">
              View your profile
            </Link>
          </div>
        ) : null}
      </section>
    </main>
  );
}
