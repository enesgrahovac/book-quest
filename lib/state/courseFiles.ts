import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { BookAnalysis } from "@/lib/pdf/analyzeBook";

function getRootStateDir() {
  return path.resolve(process.cwd(), process.env.BOOK_QUEST_STATE_DIR ?? "state/users");
}

function userDir(userId: string) {
  return path.join(getRootStateDir(), userId);
}

function uploadsDir(userId: string) {
  return path.join(userDir(userId), "uploads");
}

function coursesDir(userId: string) {
  return path.join(userDir(userId), "courses");
}

function courseDir(userId: string, courseId: string) {
  return path.join(coursesDir(userId), courseId);
}

// ---------------------------------------------------------------------------
// Upload directory
// ---------------------------------------------------------------------------

export async function ensureUploadDir(userId: string) {
  const dir = uploadsDir(userId);
  await mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Save PDF upload
// ---------------------------------------------------------------------------

export async function savePdfUpload(
  userId: string,
  filename: string,
  buffer: Buffer
): Promise<{ originalFilename: string; storagePath: string; sizeBytes: number }> {
  const dir = await ensureUploadDir(userId);
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = path.join(dir, `${Date.now()}_${safeName}`);
  await writeFile(storagePath, buffer);

  return {
    originalFilename: filename,
    storagePath,
    sizeBytes: buffer.length
  };
}

// ---------------------------------------------------------------------------
// Extracted text
// ---------------------------------------------------------------------------

export async function saveExtractedText(
  userId: string,
  courseId: string,
  pages: string[]
): Promise<void> {
  const dir = courseDir(userId, courseId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "extracted_text.json"), JSON.stringify({ pages }, null, 2), "utf8");
}

export async function readExtractedText(
  userId: string,
  courseId: string
): Promise<string[] | null> {
  try {
    const content = await readFile(
      path.join(courseDir(userId, courseId), "extracted_text.json"),
      "utf8"
    );
    const parsed = JSON.parse(content) as { pages?: string[] };
    return Array.isArray(parsed.pages) ? parsed.pages : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Book analysis
// ---------------------------------------------------------------------------

export async function saveBookAnalysis(
  userId: string,
  courseId: string,
  analysis: BookAnalysis
): Promise<void> {
  const dir = courseDir(userId, courseId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "book_analysis.json"), JSON.stringify(analysis, null, 2), "utf8");
}

export async function readBookAnalysis(
  userId: string,
  courseId: string
): Promise<BookAnalysis | null> {
  try {
    const content = await readFile(
      path.join(courseDir(userId, courseId), "book_analysis.json"),
      "utf8"
    );
    return JSON.parse(content) as BookAnalysis;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Course plan
// ---------------------------------------------------------------------------

export type CoursePlan = {
  title: string;
  description: string;
  estimatedHours: number;
  units: Array<{
    unitNumber: number;
    title: string;
    summary: string;
    objectives: string[];
    sourceChapters: number[];
    estimatedMinutes: number;
  }>;
};

export async function saveCoursePlan(
  userId: string,
  courseId: string,
  plan: CoursePlan
): Promise<{ courseId: string; plan: CoursePlan; savedAt: string }> {
  const dir = courseDir(userId, courseId);
  await mkdir(dir, { recursive: true });
  const savedAt = new Date().toISOString();
  await writeFile(
    path.join(dir, "course_plan.json"),
    JSON.stringify({ ...plan, savedAt }, null, 2),
    "utf8"
  );
  return { courseId, plan, savedAt };
}

export async function readCoursePlan(
  userId: string,
  courseId: string
): Promise<CoursePlan | null> {
  try {
    const content = await readFile(
      path.join(courseDir(userId, courseId), "course_plan.json"),
      "utf8"
    );
    return JSON.parse(content) as CoursePlan;
  } catch {
    return null;
  }
}
