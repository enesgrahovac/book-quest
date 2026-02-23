"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const DOC_KEYS = ["SOUL", "PROFILE", "PREFERENCES", "MEMORY", "TUTOR_PERSONA"] as const;
type DocKey = (typeof DOC_KEYS)[number];

type StateDocResponse = {
  key: DocKey;
  content: string;
  updatedAt: string;
};

type LoadState = "idle" | "loading" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

export default function StateEditorPage({ params }: { params: { userId: string } }) {
  const userId = decodeURIComponent(params.userId);
  const [activeKey, setActiveKey] = useState<DocKey>("PROFILE");
  const [content, setContent] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  const endpoint = useMemo(
    () => `/api/state/${encodeURIComponent(userId)}/${encodeURIComponent(activeKey)}`,
    [activeKey, userId]
  );

  useEffect(() => {
    let isCancelled = false;

    async function loadDoc() {
      setLoadState("loading");
      setSaveState("idle");
      setMessage("");

      const response = await fetch(endpoint);
      if (!response.ok) {
        if (!isCancelled) {
          setLoadState("error");
          setMessage("Failed to load markdown document.");
        }
        return;
      }

      const data = (await response.json()) as StateDocResponse;
      if (!isCancelled) {
        setContent(data.content);
        setLoadState("idle");
        setMessage(`Loaded ${data.key}.`);
      }
    }

    loadDoc();

    return () => {
      isCancelled = true;
    };
  }, [endpoint]);

  async function handleSave() {
    setSaveState("saving");
    setMessage("");

    const response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
    });

    if (!response.ok) {
      setSaveState("error");
      setMessage("Save failed. Check the document content and try again.");
      return;
    }

    const data = (await response.json()) as StateDocResponse;
    setSaveState("saved");
    setMessage(`Saved ${data.key} at ${new Date(data.updatedAt).toLocaleString()}.`);
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">State Editor</p>
        <h1>Editable learner markdown state</h1>
        <p>
          User: <strong>{userId}</strong>. Edit the tutor memory/state docs directly and save.
        </p>
      </section>

      <section className="formCard">
        <div className="buttonRow">
          <label>
            Document
            <select value={activeKey} onChange={(event) => setActiveKey(event.target.value as DocKey)}>
              {DOC_KEYS.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <div className="buttonRow">
            <button onClick={handleSave} disabled={loadState === "loading" || saveState === "saving"}>
              {saveState === "saving" ? "Saving..." : "Save markdown"}
            </button>
            <Link href="/onboarding" className="ghostLink">
              Back to onboarding
            </Link>
          </div>
        </div>

        <textarea
          className="editorTextarea"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={24}
          disabled={loadState === "loading"}
        />

        {message ? <p className={saveState === "error" || loadState === "error" ? "errorText" : ""}>{message}</p> : null}
      </section>
    </main>
  );
}
