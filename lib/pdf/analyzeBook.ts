import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/model";
import { detectBookStructure, type BookStructure } from "./detectStructure";

export type ChapterAnalysis = {
  chapterNumber: number;
  title: string;
  startPage: number;
  endPage: number;
  summary: string;
  keyConcepts: string[];
  learningObjectives: string[];
  prerequisites: string[];
  estimatedReadingMinutes: number;
};

export type BookAnalysis = {
  title: string;
  author?: string;
  totalPages: number;
  chapters: ChapterAnalysis[];
  detectionMethod: string;
};

const chapterAnalysisSchema = z.object({
  summary: z.string(),
  keyConcepts: z.array(z.string()),
  learningObjectives: z.array(z.string()),
  prerequisites: z.array(z.string()),
  estimatedReadingMinutes: z.number()
});

// ---------------------------------------------------------------------------
// Analyze a single chapter
// ---------------------------------------------------------------------------

async function analyzeChapter(
  chapterNumber: number,
  title: string,
  chapterText: string,
  previousChapterContext: string | null
): Promise<Omit<ChapterAnalysis, "chapterNumber" | "title" | "startPage" | "endPage">> {
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);

  if (!hasApiKey) {
    return {
      summary: `Content from "${title}".`,
      keyConcepts: [],
      learningObjectives: [],
      prerequisites: [],
      estimatedReadingMinutes: Math.max(5, Math.round(chapterText.split(/\s+/).length / 250))
    };
  }

  // Truncate chapter text to ~20K tokens worth (~80K chars)
  const maxChars = 80_000;
  const truncatedText =
    chapterText.length > maxChars ? chapterText.slice(0, maxChars) + "\n[...truncated]" : chapterText;

  const contextBlock = previousChapterContext
    ? `\nThe previous chapter covered these key concepts: ${previousChapterContext}\n`
    : "";

  try {
    const { object } = await generateObject({
      model: getModel(),
      system:
        "You analyze a single chapter/section of a textbook. Provide a concise summary, key concepts, learning objectives, prerequisites (concepts from earlier chapters this builds on), and an estimated reading time in minutes.",
      prompt: `Chapter ${chapterNumber}: "${title}"${contextBlock}\n\nChapter text:\n${truncatedText}`,
      temperature: 0.2,
      schema: chapterAnalysisSchema
    });

    return {
      summary: object.summary || `Content from "${title}".`,
      keyConcepts: object.keyConcepts || [],
      learningObjectives: object.learningObjectives || [],
      prerequisites: object.prerequisites || [],
      estimatedReadingMinutes:
        typeof object.estimatedReadingMinutes === "number" && object.estimatedReadingMinutes > 0
          ? object.estimatedReadingMinutes
          : Math.max(5, Math.round(chapterText.split(/\s+/).length / 250))
    };
  } catch {
    return {
      summary: `Content from "${title}".`,
      keyConcepts: [],
      learningObjectives: [],
      prerequisites: [],
      estimatedReadingMinutes: Math.max(5, Math.round(chapterText.split(/\s+/).length / 250))
    };
  }
}

// ---------------------------------------------------------------------------
// Run chapter analyses with concurrency limit and cross-chapter context
// ---------------------------------------------------------------------------

async function analyzeChaptersWithContext(
  structure: BookStructure,
  pages: string[]
): Promise<ChapterAnalysis[]> {
  const results: ChapterAnalysis[] = new Array(structure.chapters.length);
  const concurrencyLimit = 5;

  // We process sequentially in batches to maintain cross-chapter context.
  // Within each batch, chapters run in parallel. The first chapter of each
  // batch gets context from the last chapter of the previous batch.

  for (let batchStart = 0; batchStart < structure.chapters.length; batchStart += concurrencyLimit) {
    const batchEnd = Math.min(batchStart + concurrencyLimit, structure.chapters.length);
    const batchPromises: Promise<void>[] = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const chapter = structure.chapters[i];
      const chapterText = pages.slice(chapter.startPage, chapter.endPage + 1).join("\n\n");

      // Cross-chapter context: use previous chapter's key concepts if available
      let previousContext: string | null = null;
      if (i > 0 && results[i - 1]) {
        previousContext = results[i - 1].keyConcepts.join(", ");
      }

      const promise = analyzeChapter(i + 1, chapter.title, chapterText, previousContext).then(
        (analysis) => {
          results[i] = {
            chapterNumber: i + 1,
            title: chapter.title,
            startPage: chapter.startPage,
            endPage: chapter.endPage,
            ...analysis
          };
        }
      );

      batchPromises.push(promise);
    }

    await Promise.all(batchPromises);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function analyzeBook(buffer: Buffer, pages: string[]): Promise<BookAnalysis> {
  const structure = await detectBookStructure(buffer, pages);
  const chapters = await analyzeChaptersWithContext(structure, pages);

  return {
    title: structure.title,
    author: structure.author,
    totalPages: pages.length,
    chapters,
    detectionMethod: structure.detectionMethod
  };
}
