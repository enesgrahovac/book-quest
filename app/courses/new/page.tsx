"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState, DragEvent } from "react";
import ReactMarkdown from "react-markdown";

import type { BookAnalysis } from "@/lib/pdf/analyzeBook";
import type { CoursePlan } from "@/lib/state/courseFiles";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatMessage = {
  role: "assistant" | "user";
  content: string;
};

type AgentNextResponse = {
  assistantMessage: string;
  readyToGenerate: boolean;
  knownGaps: string[];
  requestingUpload: boolean;
};

type AgentStreamDelta = {
  chunk?: string;
};

type NetworkState = "idle" | "loading";

const USER_ID = "local-learner";

// ---------------------------------------------------------------------------
// SSE parsing (mirrors onboarding)
// ---------------------------------------------------------------------------

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

  if (!event || !dataLines.length) return null;

  return { event, data: dataLines.join("\n") };
}

function nextSseDelimiter(buffer: string) {
  const match = buffer.match(/\r?\n\r?\n/);
  if (!match || typeof match.index !== "number") return null;
  return { index: match.index, length: match[0].length };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CourseCreationPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [knownGaps, setKnownGaps] = useState<string[]>([]);
  const [readyToGenerate, setReadyToGenerate] = useState(false);
  const [requestingUpload, setRequestingUpload] = useState(false);
  const [networkState, setNetworkState] = useState<NetworkState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [modifierKeyLabel, setModifierKeyLabel] = useState<"Ctrl" | "Cmd">("Ctrl");

  // Upload & processing state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);

  // Book analysis & course plan
  const [bookAnalysis, setBookAnalysis] = useState<BookAnalysis | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [coursePlan, setCoursePlan] = useState<CoursePlan | null>(null);
  const [planGenerating, setPlanGenerating] = useState(false);
  const [finalizedAt, setFinalizedAt] = useState<string | null>(null);

  // Editable plan state
  const [editablePlan, setEditablePlan] = useState<CoursePlan | null>(null);

  // Draft persistence
  const [pendingDraft, setPendingDraft] = useState<{
    messages: ChatMessage[];
    bookAnalysis: BookAnalysis | null;
    courseId: string | null;
    coursePlan: CoursePlan | null;
    editablePlan: CoursePlan | null;
    knownGaps: string[];
    readyToGenerate: boolean;
    requestingUpload: boolean;
    savedAt: string;
  } | null>(null);
  const [draftChecked, setDraftChecked] = useState(false);

  const chatPanelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasConversation = messages.length > 0;
  const canSendAnswer =
    networkState === "idle" &&
    hasConversation &&
    draftAnswer.trim().length > 0 &&
    !finalizedAt &&
    !processingStatus &&
    !planGenerating;
  const showUploadZone = requestingUpload && !bookAnalysis && !processingStatus;

  const agentEndpoint = "/api/courses/agent";
  const uploadEndpoint = "/api/courses/upload";

  // Auto-scroll
  useEffect(() => {
    const panel = chatPanelRef.current;
    if (panel) panel.scrollTop = panel.scrollHeight;
  }, [messages, networkState, processingStatus]);

  useEffect(() => {
    if (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent)) {
      setModifierKeyLabel("Cmd");
    }
  }, []);

  // Sync editable plan with generated plan
  useEffect(() => {
    if (coursePlan && !editablePlan) {
      setEditablePlan(structuredClone(coursePlan));
    }
  }, [coursePlan, editablePlan]);

  // Check for existing draft on mount
  useEffect(() => {
    fetch("/api/courses/draft")
      .then((r) => r.json())
      .then((data: { draft: typeof pendingDraft }) => {
        if (data.draft && data.draft.messages.length > 0) {
          setPendingDraft(data.draft);
        }
      })
      .catch(() => {})
      .finally(() => setDraftChecked(true));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft when conversation state changes (debounced via idle network)
  useEffect(() => {
    if (!draftChecked || !messages.length || finalizedAt || networkState !== "idle") return;
    const timer = setTimeout(() => {
      fetch("/api/courses/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          bookAnalysis,
          courseId,
          coursePlan,
          editablePlan,
          knownGaps,
          readyToGenerate,
          requestingUpload,
        }),
      }).catch(() => {});
    }, 1000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, bookAnalysis, courseId, coursePlan, editablePlan, knownGaps, readyToGenerate, requestingUpload, networkState, finalizedAt, draftChecked]);

  function resumeDraft() {
    if (!pendingDraft) return;
    setMessages(pendingDraft.messages);
    setBookAnalysis(pendingDraft.bookAnalysis);
    setCourseId(pendingDraft.courseId);
    setCoursePlan(pendingDraft.coursePlan);
    setEditablePlan(pendingDraft.editablePlan);
    setKnownGaps(pendingDraft.knownGaps);
    setReadyToGenerate(pendingDraft.readyToGenerate);
    setRequestingUpload(pendingDraft.requestingUpload ?? false);
    setPendingDraft(null);
  }

  function dismissDraft() {
    setPendingDraft(null);
    fetch("/api/courses/draft", { method: "DELETE" }).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // SSE streaming
  // ---------------------------------------------------------------------------

  const appendAssistantDelta = useCallback((chunk: string) => {
    if (!chunk) return;
    setMessages((current) => {
      if (!current.length) return [{ role: "assistant", content: chunk }];
      const last = current[current.length - 1];
      if (last.role !== "assistant") return [...current, { role: "assistant", content: chunk }];
      const updated = [...current];
      updated[updated.length - 1] = { ...last, content: `${last.content}${chunk}` };
      return updated;
    });
  }, []);

  async function requestNextQuestionStream(
    conversation: ChatMessage[],
    analysis: BookAnalysis | null,
    onDelta: (chunk: string) => void
  ) {
    const response = await fetch(agentEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "next",
        stream: true,
        userId: USER_ID,
        messages: conversation,
        bookAnalysis: analysis
      })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(data?.error ?? "Failed to get next question.");
    }

    if (!response.body) throw new Error("Streaming response was empty.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let donePayload: AgentNextResponse | null = null;
    let streamError: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: !done });

      let separator = nextSseDelimiter(buffer);
      while (separator) {
        const block = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        separator = nextSseDelimiter(buffer);

        const parsedBlock = parseSseBlock(block);
        if (!parsedBlock) continue;

        try {
          if (parsedBlock.event === "delta") {
            const payload = JSON.parse(parsedBlock.data) as AgentStreamDelta;
            if (typeof payload.chunk === "string") {
              onDelta(payload.chunk);
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
            continue;
          }

          if (parsedBlock.event === "meta") {
            const payload = JSON.parse(parsedBlock.data) as {
              readyToGenerate?: unknown;
              knownGaps?: unknown;
              requestingUpload?: unknown;
            };
            if (typeof payload.readyToGenerate === "boolean") setReadyToGenerate(payload.readyToGenerate);
            if (Array.isArray(payload.knownGaps)) {
              setKnownGaps(
                payload.knownGaps.filter((g): g is string => typeof g === "string" && g.trim().length > 0)
              );
            }
            if (typeof payload.requestingUpload === "boolean") setRequestingUpload(payload.requestingUpload);
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

      if (done) break;
    }

    if (streamError) throw new Error(streamError);
    if (!donePayload) throw new Error("Tutor stream ended without a final payload.");
    return donePayload;
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function startConversation() {
    setNetworkState("loading");
    setErrorMessage("");
    setReadyToGenerate(false);
    setRequestingUpload(false);
    setKnownGaps([]);
    setBookAnalysis(null);
    setCourseId(null);
    setCoursePlan(null);
    setEditablePlan(null);
    setFinalizedAt(null);
    setSelectedFiles([]);

    try {
      setMessages([]);
      const next = await requestNextQuestionStream([], null, appendAssistantDelta);
      setMessages([{ role: "assistant", content: next.assistantMessage }]);
      setReadyToGenerate(next.readyToGenerate);
      setKnownGaps(next.knownGaps);
      setRequestingUpload(next.requestingUpload);
    } catch (error) {
      setMessages([]);
      setErrorMessage(error instanceof Error ? error.message : "Failed to start conversation.");
    } finally {
      setNetworkState("idle");
    }
  }

  const sendPlanEdit = useCallback(async () => {
    if (!editablePlan || !bookAnalysis) return;

    setNetworkState("loading");
    setErrorMessage("");
    const instruction = draftAnswer.trim();
    const previousConversation = messages;
    const userMessage: ChatMessage = { role: "user", content: instruction };
    const updatedConversation = [...previousConversation, userMessage];
    setMessages(updatedConversation);
    setDraftAnswer("");

    try {
      const response = await fetch(agentEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "edit-plan",
          userId: USER_ID,
          messages: updatedConversation,
          bookAnalysis,
          currentPlan: editablePlan,
          editInstruction: instruction,
          courseId
        })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to edit plan.");
      }

      const result = (await response.json()) as {
        plan: CoursePlan;
        bookAnalysis: BookAnalysis | null;
        explanation: string;
      };

      setEditablePlan(structuredClone(result.plan));
      setCoursePlan(result.plan);
      if (result.bookAnalysis) {
        setBookAnalysis(result.bookAnalysis);
      }
      setMessages([...updatedConversation, { role: "assistant", content: result.explanation }]);
    } catch (error) {
      setMessages(previousConversation);
      setDraftAnswer(instruction);
      setErrorMessage(error instanceof Error ? error.message : "Could not edit the plan.");
    } finally {
      setNetworkState("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editablePlan, bookAnalysis, draftAnswer, messages, courseId]);

  const sendAnswer = useCallback(async () => {
    if (!canSendAnswer) return;

    // If we have an editable plan, route to the edit-plan flow
    if (editablePlan) {
      return sendPlanEdit();
    }

    setNetworkState("loading");
    setErrorMessage("");
    const previousConversation = messages;
    const userMessage: ChatMessage = { role: "user", content: draftAnswer.trim() };
    const updatedConversation = [...previousConversation, userMessage];
    setMessages(updatedConversation);
    setDraftAnswer("");

    try {
      const next = await requestNextQuestionStream(
        updatedConversation,
        bookAnalysis,
        appendAssistantDelta
      );
      setMessages([...updatedConversation, { role: "assistant", content: next.assistantMessage }]);
      setReadyToGenerate(next.readyToGenerate);
      setKnownGaps(next.knownGaps);
      setRequestingUpload(next.requestingUpload);
    } catch (error) {
      setMessages(previousConversation);
      setDraftAnswer(userMessage.content);
      setErrorMessage(error instanceof Error ? error.message : "Could not process your answer.");
    } finally {
      setNetworkState("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appendAssistantDelta, canSendAnswer, draftAnswer, messages, bookAnalysis, editablePlan, sendPlanEdit]);

  // ---------------------------------------------------------------------------
  // File upload
  // ---------------------------------------------------------------------------

  function handleFilesSelected(files: FileList | null) {
    if (!files) return;
    const pdfs = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length) setSelectedFiles((prev) => [...prev, ...pdfs]);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFilesSelected(e.dataTransfer.files);
  }

  function removeFile(index: number) {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function uploadFiles() {
    if (!selectedFiles.length) return;

    setProcessingStatus("Uploading your PDF...");
    setErrorMessage("");

    const formData = new FormData();
    formData.append("userId", USER_ID);
    for (const file of selectedFiles) {
      formData.append("files", file);
    }

    try {
      setProcessingStatus("Reading your book...");

      const response = await fetch(uploadEndpoint, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Upload failed.");
      }

      setProcessingStatus("Analyzing chapter structure...");

      const result = (await response.json()) as {
        courseId: string;
        uploadedFiles: Array<{ originalFilename: string; totalPages: number }>;
        bookAnalysis: BookAnalysis;
      };

      const fileInfo = result.uploadedFiles
        .map((f) => `${f.originalFilename} (${f.totalPages} pages)`)
        .join(", ");

      setProcessingStatus(
        `Found ${result.bookAnalysis.chapters.length} chapters. Analysis complete!`
      );

      setBookAnalysis(result.bookAnalysis);
      setCourseId(result.courseId);
      setSelectedFiles([]);
      setRequestingUpload(false);

      // Add a user message summarizing the upload
      const uploadMessage: ChatMessage = {
        role: "user",
        content: `I've uploaded: ${fileInfo}`
      };

      await new Promise<void>((resolve) => setTimeout(resolve, 1500));
      setProcessingStatus(null);

      // Continue conversation with book context
      setNetworkState("loading");
      const updatedConversation = [...messages, uploadMessage];
      setMessages(updatedConversation);

      const next = await requestNextQuestionStream(
        updatedConversation,
        result.bookAnalysis,
        appendAssistantDelta
      );
      setMessages([...updatedConversation, { role: "assistant", content: next.assistantMessage }]);
      setReadyToGenerate(next.readyToGenerate);
      setKnownGaps(next.knownGaps);
      setNetworkState("idle");
    } catch (error) {
      setProcessingStatus(null);
      setErrorMessage(error instanceof Error ? error.message : "Upload failed.");
    }
  }

  // ---------------------------------------------------------------------------
  // Course plan generation
  // ---------------------------------------------------------------------------

  async function generatePlan() {
    if (!bookAnalysis) return;

    setPlanGenerating(true);
    setErrorMessage("");

    try {
      const response = await fetch(agentEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "generate-plan",
          userId: USER_ID,
          messages,
          bookAnalysis
        })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to generate plan.");
      }

      const result = (await response.json()) as { plan: CoursePlan };
      setCoursePlan(result.plan);
      setEditablePlan(structuredClone(result.plan));
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Here's your course plan! Take a look and let me know if you'd like any changes — you can ask me to add, remove, rename, or rearrange anything."
        }
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Plan generation failed.");
    } finally {
      setPlanGenerating(false);
    }
  }

  async function finalizePlan() {
    if (!editablePlan || !courseId) return;

    setNetworkState("loading");
    setErrorMessage("");

    try {
      const response = await fetch(agentEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "finalize",
          userId: USER_ID,
          courseId,
          coursePlan: editablePlan
        })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Failed to save course.");
      }

      const result = (await response.json()) as { savedAt: string };
      setFinalizedAt(result.savedAt);
      setCoursePlan(editablePlan);
      // Clear draft on finalize
      fetch("/api/courses/draft", { method: "DELETE" }).catch(() => {});
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to save course.");
    } finally {
      setNetworkState("idle");
    }
  }

  // regeneratePlan removed — users edit via chat instead

  // ---------------------------------------------------------------------------
  // Plan editing helpers
  // ---------------------------------------------------------------------------

  function updatePlanField(field: "title" | "description", value: string) {
    if (!editablePlan) return;
    setEditablePlan({ ...editablePlan, [field]: value });
  }

  function updateUnitField(unitIndex: number, field: "title" | "summary", value: string) {
    if (!editablePlan) return;
    const units = [...editablePlan.units];
    units[unitIndex] = { ...units[unitIndex], [field]: value };
    setEditablePlan({ ...editablePlan, units });
  }

  function updateUnitObjective(unitIndex: number, objIndex: number, value: string) {
    if (!editablePlan) return;
    const units = [...editablePlan.units];
    const objectives = [...units[unitIndex].objectives];
    objectives[objIndex] = value;
    units[unitIndex] = { ...units[unitIndex], objectives };
    setEditablePlan({ ...editablePlan, units });
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const showTwoColumn = (Boolean(editablePlan) || planGenerating) && !finalizedAt;

  return (
    <main className={`page courseCreationPage${showTwoColumn ? " twoColumn" : ""}`}>
      <header className="courseHeader">
        <div className="courseHeaderLeft">
          <Link href="/" className="courseBackLink" aria-label="Back to home">&larr;</Link>
          <div>
            <p className="eyebrow">Course Creation</p>
            <h1>Let&apos;s build your course.</h1>
          </div>
        </div>
        <div className="courseHeaderActions">
          <button type="button" onClick={startConversation} disabled={networkState === "loading"}>
            {hasConversation ? "Start over" : "Get started"}
          </button>
        </div>
      </header>

      {pendingDraft && !hasConversation ? (
        <div className="draftResumeCard">
          <p>
            You have an in-progress course from{" "}
            <strong>{new Date(pendingDraft.savedAt).toLocaleString()}</strong>
          </p>
          <div className="buttonRow">
            <button type="button" onClick={resumeDraft}>
              Resume
            </button>
            <button type="button" className="btnSecondary" onClick={dismissDraft}>
              Start fresh
            </button>
          </div>
        </div>
      ) : null}

      <div className={showTwoColumn ? "columnsWrapper" : "chatColumnSingle"}>
      <div className="chatColumn">

      <section className="formCard">
        <div className="chatPanel" ref={chatPanelRef}>
          {messages.length === 0 && networkState === "idle" && !processingStatus ? (
            <div className="chatEmptyState">
              <div className="chatEmptyIcon" aria-hidden="true">
                &#128218;
              </div>
              <p>
                Click <strong>&quot;Get started&quot;</strong> above to chat with your tutor about
                building a course.
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
                <div className="chatMessageContent">
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              </article>
            ))
          )}

          {processingStatus ? (
            <article className="chatMessage assistantBubble processingBubble">
              <p className="chatRole">
                <span className="chatRoleIcon">T</span>
                Tutor
              </p>
              <p className="processingStep">{processingStatus}</p>
            </article>
          ) : null}

          {networkState === "loading" &&
          !processingStatus &&
          messages[messages.length - 1]?.role !== "assistant" ? (
            <div className="typingIndicator">
              <span className="chatRoleIcon" style={{ background: "var(--accent)" }}>
                T
              </span>
              <div className="typingDots">
                <span className="typingDot" />
                <span className="typingDot" />
                <span className="typingDot" />
              </div>
            </div>
          ) : null}
        </div>

        {/* Composer area */}
        <form onSubmit={handleSendAnswer} className="answerComposer">
          {showUploadZone ? (
            <div
              className={`composerUploadZone ${dragOver ? "dragOver" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                multiple
                style={{ display: "none" }}
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <p>Drop your PDF here, or click to browse</p>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--muted)" }}>
                PDF files only, max 32 MB each
              </p>
            </div>
          ) : null}

          {selectedFiles.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}>
              {selectedFiles.map((file, i) => (
                <span key={`${file.name}-${i}`} className="uploadFileChip">
                  {file.name} ({formatFileSize(file.size)})
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: "0 0 0 var(--space-2)",
                      cursor: "pointer",
                      color: "var(--muted)",
                      fontSize: "var(--text-sm)"
                    }}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <label>
            Your message
            <textarea
              value={draftAnswer}
              onChange={(event) => setDraftAnswer(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={showTwoColumn ? 3 : 4}
              disabled={
                !hasConversation ||
                networkState === "loading" ||
                Boolean(finalizedAt) ||
                Boolean(processingStatus)
              }
              placeholder={
                showUploadZone
                  ? "Drop your PDF above, or type a message..."
                  : editablePlan
                    ? "Ask to edit the plan (e.g. 'add the last chapter', 'rename unit 3')..."
                    : "Type your response..."
              }
            />
            <span className="keyboardHint">Press {modifierKeyLabel}+Enter to send</span>
          </label>

          <div className="buttonRow">
            {selectedFiles.length > 0 ? (
              <button
                type="button"
                onClick={uploadFiles}
                disabled={Boolean(processingStatus)}
              >
                {processingStatus ? "Processing..." : "Upload & analyze"}
              </button>
            ) : (
              <button type="submit" disabled={!canSendAnswer}>
                {networkState === "loading" ? "Thinking..." : "Send"}
              </button>
            )}

            {readyToGenerate && !coursePlan && !planGenerating ? (
              <button type="button" className="btnSecondary" onClick={generatePlan}>
                Generate course plan
              </button>
            ) : null}

            {planGenerating ? (
              <button type="button" className="btnSecondary" disabled>
                Generating plan...
              </button>
            ) : null}
          </div>
        </form>

        {knownGaps.length > 0 && !coursePlan ? (
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
      </section>

      </div>

      {/* Skeleton loading state */}
      {planGenerating && !editablePlan && !finalizedAt ? (
        <div className="planColumn">
          <section className="planCard">
            <h2 className="planColumnHeading">Course Plan</h2>
            <div className="planHeader">
              <div className="skeleton skeletonTitle" />
              <div className="skeleton skeletonDescription" />
              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <div className="skeleton skeletonBadge" />
                <div className="skeleton skeletonBadge" />
                <div className="skeleton skeletonBadge" />
              </div>
            </div>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="unitCard" style={{ opacity: 1 - i * 0.15 }}>
                <div style={{ display: "flex", gap: "var(--space-2)" }}>
                  <div className="skeleton skeletonBadge" />
                  <div className="skeleton skeletonBadge" />
                </div>
                <div className="skeleton skeletonLine" style={{ width: "70%" }} />
                <div className="skeleton skeletonLine" style={{ width: "100%" }} />
                <div className="skeleton skeletonLine" style={{ width: "85%" }} />
              </div>
            ))}
          </section>
        </div>
      ) : null}

      {/* Plan review card */}
      {editablePlan && !finalizedAt ? (
        <div className="planColumn">
          <section className="planCard">
            <h2 className="planColumnHeading">Course Plan</h2>
            <div className="planHeader">
              <label>
                Course title
                <input
                  type="text"
                  value={editablePlan.title}
                  onChange={(e) => updatePlanField("title", e.target.value)}
                />
              </label>
              <label>
                Description
                <textarea
                  rows={3}
                  value={editablePlan.description}
                  onChange={(e) => updatePlanField("description", e.target.value)}
                />
              </label>
              <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <span className="badge">
                  ~{editablePlan.estimatedHours} hours total
                </span>
                <span className="badge">{editablePlan.units.length} units</span>
                {bookAnalysis ? (
                  <span className="badge">
                    {bookAnalysis.chapters.length} chapters in source
                  </span>
                ) : null}
              </div>
            </div>

            {editablePlan.units.map((unit, ui) => (
              <div key={unit.unitNumber} className="unitCard">
                <div className="unitCardHeader">
                  <span className="badge">Unit {unit.unitNumber}</span>
                  <span className="badge">{unit.estimatedMinutes} min</span>
                  {unit.sourceChapters.length > 0 ? (
                    <span className="badge">
                      Ch. {unit.sourceChapters.join(", ")}
                    </span>
                  ) : null}
                </div>
                <label>
                  Title
                  <input
                    type="text"
                    value={unit.title}
                    onChange={(e) => updateUnitField(ui, "title", e.target.value)}
                  />
                </label>
                <label>
                  Summary
                  <textarea
                    rows={2}
                    value={unit.summary}
                    onChange={(e) => updateUnitField(ui, "summary", e.target.value)}
                  />
                </label>
                <div className="objectivesList">
                  <p>Objectives</p>
                  {unit.objectives.map((obj, oi) => (
                    <input
                      key={oi}
                      type="text"
                      value={obj}
                      onChange={(e) => updateUnitObjective(ui, oi, e.target.value)}
                      placeholder={`Objective ${oi + 1}`}
                    />
                  ))}
                </div>
              </div>
            ))}

            <div className="buttonRow">
              <button type="button" onClick={finalizePlan} disabled={networkState === "loading"}>
                {networkState === "loading" ? "Saving..." : "Approve & create course"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      </div>

      {/* Success state */}
      {finalizedAt ? (
        <section className="successBox">
          <p>
            Your course <strong>{coursePlan?.title}</strong> has been created!
          </p>
          <p className="successMeta">
            Saved at {new Date(finalizedAt).toLocaleString()}
          </p>
          <Link href="/" className="ctaLink">
            Back to home
          </Link>
        </section>
      ) : null}
    </main>
  );
}
