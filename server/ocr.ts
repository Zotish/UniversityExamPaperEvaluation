import fs from "node:fs";
import { extractPdfTextAndPages } from "./pdf.ts";
import type {
  ExtractedQuestionChunk,
  OcrCapabilityReport,
  OcrExtractionResult,
} from "./types.ts";

export interface OcrProvider {
  name: string;
  getCapabilities(): OcrCapabilityReport;
  extractDocument(filePath: string, mimeType: string): Promise<OcrExtractionResult>;
}

export function getOcrCapabilities(): OcrCapabilityReport {
  const hasVisionApi = Boolean(process.env.GEMINI_API_KEY || process.env.OCR_API_KEY);
  return {
    selectablePdfText: true,
    scannedImageOcr: hasVisionApi,
    handwritingOcr: hasVisionApi,
    providerName: hasVisionApi
      ? process.env.GEMINI_API_KEY
        ? "Local PDF Parser + Gemini Vision OCR"
        : "Local PDF Parser + Configured External OCR"
      : "Local Selectable PDF Text Extractor",
    configurationNote: hasVisionApi
      ? "Selectable PDF extraction and external OCR vision provider are configured."
      : "Selectable PDF text extraction is active. Scanned image and handwritten OCR require configuring GEMINI_API_KEY or OCR_API_KEY in server environment variables; image uploads will be flagged for manual transcription.",
  };
}

export function parseQuestionChunks(fullText: string, pageCount: number): ExtractedQuestionChunk[] {
  if (!fullText.trim()) return [];

  const lines = fullText.split(/\r?\n/);
  const chunks: ExtractedQuestionChunk[] = [];
  let currentQ: number | null = null;
  let currentLines: string[] = [];
  let currentPage = 1;

  const qHeaderRegex = /^(?:Q(?:uestion)?\.?\s*#?\s*|Ans(?:wer)?\s*(?:to)?\s*Q(?:uestion)?\.?\s*)?(\d{1,2})\s*[.):\-]\s*(.*)$/i;
  const pageMarkerRegex = /Page\s+(\d+)\s+of\s+\d+/i;

  const flush = () => {
    if (currentQ !== null) {
      const text = currentLines.join("\n").trim();
      chunks.push({
        questionNumber: currentQ,
        text,
        pageNumber: currentPage,
        uncertain: text.length === 0,
      });
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const pageMatch = line.match(pageMarkerRegex);
    if (pageMatch) {
      const parsedPage = parseInt(pageMatch[1], 10);
      if (!Number.isNaN(parsedPage) && parsedPage >= 1 && parsedPage <= pageCount) {
        currentPage = parsedPage;
      }
      continue;
    }

    // Skip university header boilerplate lines
    if (
      /^(Stamford University Bangladesh|Department of Computer Science|Course:|Student:|ID:|Exam:|Evaluation Sheet)/i.test(
        line
      )
    ) {
      continue;
    }

    const qMatch = line.match(qHeaderRegex);
    if (qMatch) {
      const qNum = parseInt(qMatch[1], 10);
      if (qNum >= 1 && qNum <= 50) {
        flush();
        currentQ = qNum;
        currentLines = qMatch[2] ? [qMatch[2].trim()] : [];
        continue;
      }
    }

    if (currentQ !== null) {
      currentLines.push(line);
    }
  }

  flush();
  return chunks;
}

class ModularOcrProvider implements OcrProvider {
  name = "EvalDesk Modular OCR";

  getCapabilities(): OcrCapabilityReport {
    return getOcrCapabilities();
  }

  async extractDocument(filePath: string, mimeType: string): Promise<OcrExtractionResult> {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        pageCount: 1,
        fullText: "",
        chunks: [],
        uncertain: true,
        message: "Uploaded file could not be located in private storage.",
        provider: this.name,
      };
    }

    const buffer = fs.readFileSync(filePath);

    if (mimeType === "application/pdf" || filePath.toLowerCase().endsWith(".pdf")) {
      const parsed = extractPdfTextAndPages(buffer);
      if (parsed.hasSelectableText) {
        const chunks = parseQuestionChunks(parsed.text, parsed.pageCount);
        return {
          success: true,
          pageCount: parsed.pageCount,
          fullText: parsed.text,
          chunks,
          uncertain: chunks.length === 0,
          message:
            chunks.length > 0
              ? `Extracted ${chunks.length} question response(s) from ${parsed.pageCount} PDF page(s).`
              : "Selectable text was extracted, but question numbering boundaries were unclear. Please verify manually.",
          provider: "Local Selectable PDF Text Extractor",
        };
      }

      // Scanned / image-based PDF without selectable text
      return {
        success: false,
        pageCount: parsed.pageCount,
        fullText: "",
        chunks: [],
        uncertain: true,
        message:
          "This PDF appears to be scanned without embedded selectable text, and no external OCR provider is configured. Flagged for manual transcription and teacher review.",
        provider: "Local Selectable PDF Text Extractor",
      };
    }

    // Image files (JPG / JPEG / PNG)
    if (mimeType.startsWith("image/")) {
      // Without external OCR credentials configured, never fabricate extracted text
      return {
        success: false,
        pageCount: 1,
        fullText: "",
        chunks: [],
        uncertain: true,
        message:
          "Image answer sheet stored safely. External image/handwriting OCR provider is not configured, so manual transcription or teacher inspection is required.",
        provider: "Unconfigured Image OCR (Manual Review Fallback)",
      };
    }

    return {
      success: false,
      pageCount: 1,
      fullText: "",
      chunks: [],
      uncertain: true,
      message: `Unsupported file format (${mimeType}).`,
      provider: this.name,
    };
  }
}

export const ocrProvider: OcrProvider = new ModularOcrProvider();
