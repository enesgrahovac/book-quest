import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { STATE_DOC_KEYS, type StateDocKey, type StateDocument } from "./stateTypes";

const templateMap: Record<StateDocKey, string> = {
  SOUL: "SOUL.md",
  PROFILE: "PROFILE.md",
  PREFERENCES: "PREFERENCES.md",
  MEMORY: "MEMORY.md",
  TUTOR_PERSONA: "TUTOR_PERSONA.md"
};

function getRootStateDir() {
  return path.resolve(process.cwd(), process.env.BOOK_QUEST_STATE_DIR ?? "state/users");
}

function userDir(userId: string) {
  return path.join(getRootStateDir(), userId);
}

function docPath(userId: string, key: StateDocKey) {
  return path.join(userDir(userId), `${key}.md`);
}

async function loadTemplate(fileName: string) {
  const templatePath = path.resolve(process.cwd(), "state/templates", fileName);
  return readFile(templatePath, "utf8");
}

export async function ensureUserStateFiles(userId: string) {
  const root = userDir(userId);
  await mkdir(root, { recursive: true });

  for (const key of STATE_DOC_KEYS) {
    const filePath = docPath(userId, key);
    try {
      await readFile(filePath, "utf8");
    } catch {
      const template = await loadTemplate(templateMap[key]);
      await writeFile(filePath, template, "utf8");
    }
  }
}

export async function readUserStateDoc(userId: string, key: StateDocKey): Promise<StateDocument> {
  await ensureUserStateFiles(userId);
  const content = await readFile(docPath(userId, key), "utf8");

  return {
    key,
    content,
    updatedAt: new Date().toISOString()
  };
}

export async function writeUserStateDoc(userId: string, key: StateDocKey, content: string) {
  await ensureUserStateFiles(userId);
  await writeFile(docPath(userId, key), content, "utf8");

  return {
    key,
    content,
    updatedAt: new Date().toISOString()
  };
}
