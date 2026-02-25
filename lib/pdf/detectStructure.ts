import { generateObject } from "ai";
import { z } from "zod";
import { getDocumentProxy } from "unpdf";
import { getModel } from "@/lib/ai/model";

export type ChapterBoundary = {
  title: string;
  startPage: number; // 0-based
  endPage: number; // 0-based, inclusive
};

export type BookStructure = {
  title: string;
  author?: string;
  chapters: ChapterBoundary[];
  detectionMethod: "pdf-links" | "title-match" | "llm-detection" | "fixed-chunks";
};

// ---------------------------------------------------------------------------
// Tier 1 — PDF link annotations on TOC pages
// ---------------------------------------------------------------------------

async function detectFromPdfLinks(buffer: Buffer): Promise<ChapterBoundary[] | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const tocPages = Math.min(15, pdf.numPages);
    const links: Array<{ text: string; destPage: number }> = [];

    for (let i = 1; i <= tocPages; i++) {
      const page = await pdf.getPage(i);
      const annotations = await page.getAnnotations();

      for (const annot of annotations) {
        if (annot.subtype === "Link" && annot.dest && Array.isArray(annot.dest)) {
          // dest[0] is typically a page ref object; we need to resolve it
          const destPage = typeof annot.dest[0] === "number" ? annot.dest[0] : null;
          if (destPage === null) continue;

          // Try to get link text from the annotation's content or title
          const text =
            typeof annot.contentsObj?.str === "string"
              ? annot.contentsObj.str
              : typeof annot.title === "string"
                ? annot.title
                : "";

          if (text.trim() && destPage >= 0) {
            links.push({ text: text.trim(), destPage });
          }
        }
      }
    }

    if (links.length < 3) return null;

    // Sort by destination page and build chapters
    links.sort((a, b) => a.destPage - b.destPage);

    // Deduplicate — keep first occurrence per destination page
    const seen = new Set<number>();
    const unique = links.filter((link) => {
      if (seen.has(link.destPage)) return false;
      seen.add(link.destPage);
      return true;
    });

    if (unique.length < 3) return null;

    const totalPages = pdf.numPages;
    return unique.map((link, i) => ({
      title: link.text,
      startPage: link.destPage,
      endPage: i < unique.length - 1 ? unique[i + 1].destPage - 1 : totalPages - 1
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier 2 — Title matching: extract titles from TOC text via LLM, then scan
// ---------------------------------------------------------------------------

async function detectFromTitleMatching(
  pages: string[],
  hasApiKey: boolean
): Promise<{ chapters: ChapterBoundary[]; title: string; author?: string } | null> {
  if (!hasApiKey) return null;

  // Extract TOC text from first ~15 pages
  const tocText = pages.slice(0, Math.min(15, pages.length)).join("\n---PAGE BREAK---\n");

  if (tocText.trim().length < 100) return null;

  try {
    const { object: toc } = await generateObject({
      model: getModel(),
      system:
        "You extract chapter titles from a book's table of contents. Return ONLY chapter/section titles that represent major divisions of the book — not sub-sections, figures, or appendices unless they are top-level divisions.",
      prompt: `Extract the book title, author (if visible), and chapter titles from this table of contents text:\n\n${tocText}`,
      temperature: 0.1,
      schema: z.object({
        bookTitle: z.string(),
        author: z.string().optional(),
        chapterTitles: z.array(z.string())
      })
    });

    if (!toc.chapterTitles || toc.chapterTitles.length < 2) return null;

    // Scan all pages for each title
    const chapters: ChapterBoundary[] = [];
    for (const title of toc.chapterTitles) {
      const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, "");
      for (let p = 0; p < pages.length; p++) {
        const normalizedPage = pages[p].toLowerCase().replace(/[^a-z0-9\s]/g, "");
        if (normalizedPage.includes(normalizedTitle) && normalizedTitle.length > 5) {
          chapters.push({ title, startPage: p, endPage: p });
          break;
        }
      }
    }

    if (chapters.length < 2) return null;

    // Sort by startPage and fill endPage gaps
    chapters.sort((a, b) => a.startPage - b.startPage);
    for (let i = 0; i < chapters.length; i++) {
      chapters[i].endPage =
        i < chapters.length - 1 ? chapters[i + 1].startPage - 1 : pages.length - 1;
    }

    return {
      chapters,
      title: toc.bookTitle || "Untitled",
      author: toc.author
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier 3 — LLM boundary detection from sampled pages
// ---------------------------------------------------------------------------

async function detectFromLlmSampling(
  pages: string[],
  hasApiKey: boolean
): Promise<ChapterBoundary[] | null> {
  if (!hasApiKey) return null;
  if (pages.length < 10) return null;

  // Sample every ~20th page
  const sampleIndices: number[] = [];
  const step = Math.max(1, Math.floor(pages.length / 30));
  for (let i = 0; i < pages.length; i += step) {
    sampleIndices.push(i);
  }

  const sampledText = sampleIndices
    .map((i) => `--- PAGE ${i + 1} ---\n${pages[i].slice(0, 500)}`)
    .join("\n\n");

  try {
    const { object: result } = await generateObject({
      model: getModel(),
      system:
        "You detect chapter/section boundaries in a book from sampled pages. Look for patterns like 'Chapter N', 'PART N', centered headings, or numbered section headers. Return the boundary patterns you find.",
      prompt: `Here are sampled pages from a ${pages.length}-page book. Identify the chapter/section boundary pattern and list all boundaries you can find:\n\n${sampledText}`,
      temperature: 0.1,
      schema: z.object({
        pattern: z.string().describe("The regex-like pattern for chapter boundaries"),
        boundaries: z.array(
          z.object({
            title: z.string(),
            pageNumber: z.number().describe("1-based page number")
          })
        )
      })
    });

    if (!result.boundaries || result.boundaries.length < 2) return null;

    // If we got boundaries from samples, scan all pages for the pattern
    const patternStr = result.pattern;
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(patternStr, "i");
    } catch {
      // Use boundaries as-is
    }

    let chapters: ChapterBoundary[];

    if (regex) {
      // Scan all pages with the detected pattern
      const found: Array<{ title: string; page: number }> = [];
      for (let p = 0; p < pages.length; p++) {
        const match = pages[p].match(regex);
        if (match) {
          found.push({ title: match[0].trim().slice(0, 100), page: p });
        }
      }

      if (found.length >= 2) {
        chapters = found.map((f, i) => ({
          title: f.title,
          startPage: f.page,
          endPage: i < found.length - 1 ? found[i + 1].page - 1 : pages.length - 1
        }));
      } else {
        // Fall back to sampled boundaries
        const sorted = result.boundaries.sort((a, b) => a.pageNumber - b.pageNumber);
        chapters = sorted.map((b, i) => ({
          title: b.title,
          startPage: b.pageNumber - 1,
          endPage:
            i < sorted.length - 1 ? sorted[i + 1].pageNumber - 2 : pages.length - 1
        }));
      }
    } else {
      const sorted = result.boundaries.sort((a, b) => a.pageNumber - b.pageNumber);
      chapters = sorted.map((b, i) => ({
        title: b.title,
        startPage: b.pageNumber - 1,
        endPage: i < sorted.length - 1 ? sorted[i + 1].pageNumber - 2 : pages.length - 1
      }));
    }

    return chapters;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier 4 — Fixed chunking (last resort)
// ---------------------------------------------------------------------------

function fixedChunks(pages: string[]): ChapterBoundary[] {
  const chunkSize = 30;
  const chapters: ChapterBoundary[] = [];
  for (let i = 0; i < pages.length; i += chunkSize) {
    const num = chapters.length + 1;
    chapters.push({
      title: `Section ${num}`,
      startPage: i,
      endPage: Math.min(i + chunkSize - 1, pages.length - 1)
    });
  }
  return chapters;
}

// ---------------------------------------------------------------------------
// Extract book title/author from first pages via LLM
// ---------------------------------------------------------------------------

async function extractBookMetadata(
  pages: string[],
  hasApiKey: boolean
): Promise<{ title: string; author?: string }> {
  if (!hasApiKey) {
    return { title: "Untitled Book" };
  }

  const firstPages = pages.slice(0, 5).join("\n---PAGE BREAK---\n");

  try {
    const { object } = await generateObject({
      model: getModel(),
      system: "Extract the book title and author from the first pages of a book.",
      prompt: firstPages,
      temperature: 0.1,
      schema: z.object({
        title: z.string(),
        author: z.string().optional()
      })
    });
    return { title: object.title || "Untitled Book", author: object.author };
  } catch {
    return { title: "Untitled Book" };
  }
}

// ---------------------------------------------------------------------------
// Main entry point — tries tiers in order
// ---------------------------------------------------------------------------

export async function detectBookStructure(
  buffer: Buffer,
  pages: string[]
): Promise<BookStructure> {
  const hasApiKey = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);

  // Tier 1: PDF link annotations
  const linkChapters = await detectFromPdfLinks(buffer);
  if (linkChapters && linkChapters.length >= 3) {
    const meta = await extractBookMetadata(pages, hasApiKey);
    return {
      ...meta,
      chapters: linkChapters,
      detectionMethod: "pdf-links"
    };
  }

  // Tier 2: Title matching from TOC
  const titleResult = await detectFromTitleMatching(pages, hasApiKey);
  if (titleResult && titleResult.chapters.length >= 2) {
    return {
      title: titleResult.title,
      author: titleResult.author,
      chapters: titleResult.chapters,
      detectionMethod: "title-match"
    };
  }

  // Tier 3: LLM boundary detection from sampled pages
  const llmChapters = await detectFromLlmSampling(pages, hasApiKey);
  if (llmChapters && llmChapters.length >= 2) {
    const meta = await extractBookMetadata(pages, hasApiKey);
    return {
      ...meta,
      chapters: llmChapters,
      detectionMethod: "llm-detection"
    };
  }

  // Tier 4: Fixed chunking
  const meta = await extractBookMetadata(pages, hasApiKey);
  return {
    ...meta,
    chapters: fixedChunks(pages),
    detectionMethod: "fixed-chunks"
  };
}
