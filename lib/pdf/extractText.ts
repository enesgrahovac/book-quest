import { getDocumentProxy } from "unpdf";

export type PdfExtraction = {
  totalPages: number;
  pages: string[];
};

export async function extractPdfText(buffer: Buffer): Promise<PdfExtraction> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => ("str" in item ? (item as { str: string }).str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
  }

  return { totalPages: pdf.numPages, pages };
}
