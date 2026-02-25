import { NextRequest, NextResponse } from "next/server";
import { extractPdfText } from "@/lib/pdf/extractText";
import { analyzeBook } from "@/lib/pdf/analyzeBook";
import {
  savePdfUpload,
  saveExtractedText,
  saveBookAnalysis
} from "@/lib/state/courseFiles";

export const maxDuration = 300; // 5 minutes for large books

const MAX_FILE_SIZE = 64 * 1024 * 1024; // 64 MB
const MAX_FILES = 5;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const userId = formData.get("userId");

    if (typeof userId !== "string" || !userId.trim()) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    const files = formData.getAll("files");
    if (!files.length) {
      return NextResponse.json({ error: "At least one PDF file is required." }, { status: 400 });
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_FILES} files allowed per upload.` },
        { status: 400 }
      );
    }

    const courseId = `course_${Date.now()}`;
    const uploadedFiles: Array<{ originalFilename: string; sizeBytes: number; totalPages: number }> =
      [];

    // For MVP we process the first PDF only (multi-file is a follow-up)
    let combinedPages: string[] = [];
    let primaryBuffer: Buffer | null = null;

    for (const file of files) {
      if (!(file instanceof File)) continue;

      if (!file.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: `"${file.name}" is not a PDF file.` },
          { status: 400 }
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `"${file.name}" exceeds the 32 MB limit.` },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Save the raw PDF
      await savePdfUpload(userId.trim(), file.name, buffer);

      // Extract text
      const extraction = await extractPdfText(buffer);

      uploadedFiles.push({
        originalFilename: file.name,
        sizeBytes: file.size,
        totalPages: extraction.totalPages
      });

      if (!primaryBuffer) {
        primaryBuffer = buffer;
        combinedPages = extraction.pages;
      } else {
        combinedPages = combinedPages.concat(extraction.pages);
      }
    }

    if (!primaryBuffer || !combinedPages.length) {
      return NextResponse.json({ error: "No readable PDF content found." }, { status: 400 });
    }

    // Save extracted text
    await saveExtractedText(userId.trim(), courseId, combinedPages);

    // Analyze book (structure detection + chapter analysis)
    const bookAnalysis = await analyzeBook(primaryBuffer, combinedPages);

    // Save analysis
    await saveBookAnalysis(userId.trim(), courseId, bookAnalysis);

    return NextResponse.json({
      courseId,
      uploadedFiles,
      bookAnalysis
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
