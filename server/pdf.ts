import zlib from "node:zlib";

function decodePdfString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "\\" && i + 1 < raw.length) {
      const next = raw[i + 1];
      if (next === "n") {
        out += "\n";
        i++;
      } else if (next === "r") {
        out += "\r";
        i++;
      } else if (next === "t") {
        out += "\t";
        i++;
      } else if (next === "(" || next === ")" || next === "\\") {
        out += next;
        i++;
      } else if (/[0-7]/.test(next)) {
        const oct = raw.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] || "";
        out += String.fromCharCode(parseInt(oct, 8));
        i += oct.length;
      } else {
        out += next;
        i++;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

function extractTextOperators(content: string): string {
  const lines: string[] = [];
  const btBlocks = content.match(/BT[\s\S]*?ET/g) || [content];

  for (const block of btBlocks) {
    let blockText = "";
    let i = 0;
    while (i < block.length) {
      if (block[i] === "(") {
        let depth = 1;
        let j = i + 1;
        let str = "";
        while (j < block.length && depth > 0) {
          if (block[j] === "\\" && j + 1 < block.length) {
            str += block[j] + block[j + 1];
            j += 2;
            continue;
          }
          if (block[j] === "(") depth++;
          else if (block[j] === ")") {
            depth--;
            if (depth === 0) break;
          }
          str += block[j];
          j++;
        }
        const decoded = decodePdfString(str);
        // Check operator right after closing paren or array
        const tail = block.slice(j + 1, j + 12);
        if (/^\s*(?:Tj|'|")/.test(tail) || block.slice(Math.max(0, i - 4), i).includes("[")) {
          blockText += decoded;
        } else {
          blockText += decoded;
        }
        if (/^\s*(?:T\*|Td|TD|')/.test(tail)) {
          blockText += "\n";
        }
        i = j + 1;
      } else if (block.slice(i, i + 3) === "T*" || block.slice(i, i + 3) === "Td\n") {
        blockText += "\n";
        i += 2;
      } else {
        i++;
      }
    }
    const cleaned = blockText.trim();
    if (cleaned) {
      lines.push(cleaned);
    }
  }

  return lines.join("\n");
}

export function extractPdfTextAndPages(buffer: Buffer): {
  pageCount: number;
  text: string;
  hasSelectableText: boolean;
} {
  const latin = buffer.toString("latin1");

  // Count pages (/Type /Page but not /Type /Pages)
  const pageMatches = latin.match(/\/Type\s*\/Page\b(?!s)/g);
  const pageCount = Math.max(1, pageMatches ? pageMatches.length : 1);

  const extractedChunks: string[] = [];
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;

  while ((match = streamRegex.exec(latin)) !== null) {
    const rawStream = match[1];
    if (!rawStream) continue;

    // Look back slightly to check if FlateDecode is used
    const headerStart = Math.max(0, match.index - 220);
    const dictSnippet = latin.slice(headerStart, match.index);
    const isFlate = /\/FlateDecode\b/.test(dictSnippet);

    let streamStr = rawStream;
    if (isFlate) {
      try {
        const compressed = Buffer.from(rawStream, "latin1");
        streamStr = zlib.inflateSync(compressed).toString("latin1");
      } catch {
        // Fallback if stream is partially malformed
        streamStr = "";
      }
    }

    if (streamStr.includes("Tj") || streamStr.includes("TJ") || streamStr.includes("BT")) {
      const text = extractTextOperators(streamStr);
      if (text.trim()) {
        extractedChunks.push(text.trim());
      }
    }
  }

  const fullText = extractedChunks
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    pageCount,
    text: fullText,
    hasSelectableText: fullText.length >= 15,
  };
}

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapLine(text: string, maxChars = 84): string[] {
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export interface PdfPageSpec {
  header?: string;
  subheader?: string;
  lines: string[];
}

export function generatePdfBuffer(pages: PdfPageSpec[]): Buffer {
  const safePages = pages.length ? pages : [{ lines: ["Empty document"] }];
  const objects: string[] = [];

  // 1: Catalog, 2: Pages, 3: Font Regular, 4: Font Bold
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const pageObjNums: number[] = [];

  let nextObj = 5;
  const pageEntries: { pageObj: number; contentObj: number; stream: string }[] = [];

  for (let p = 0; p < safePages.length; p++) {
    const spec = safePages[p];
    const pageObj = nextObj++;
    const contentObj = nextObj++;
    pageObjNums.push(pageObj);

    const ops: string[] = [];
    let y = 785;

    // Header band
    if (spec.header) {
      ops.push("BT");
      ops.push("/F2 13 Tf");
      ops.push(`54 ${y} Td`);
      ops.push(`(${escapePdfText(spec.header)}) Tj`);
      ops.push("ET");
      y -= 18;
    }
    if (spec.subheader) {
      ops.push("BT");
      ops.push("/F1 9 Tf");
      ops.push(`54 ${y} Td`);
      ops.push(`(${escapePdfText(spec.subheader)}) Tj`);
      ops.push("ET");
      y -= 14;
    }
    if (spec.header || spec.subheader) {
      ops.push(`0.8 w 54 ${y} m 558 ${y} l S`);
      y -= 20;
    }

    for (const rawLine of spec.lines) {
      const isHeading = rawLine.startsWith("## ");
      const text = isHeading ? rawLine.slice(3) : rawLine;
      const wrapped = wrapLine(text, isHeading ? 74 : 88);

      for (const wLine of wrapped) {
        if (y < 60) break;
        ops.push("BT");
        ops.push(isHeading ? "/F2 10.5 Tf" : "/F1 9.5 Tf");
        ops.push(`54 ${y} Td`);
        ops.push(`(${escapePdfText(wLine)}) Tj`);
        ops.push("ET");
        y -= isHeading ? 15 : 13.5;
      }
      if (rawLine === "") y -= 6;
    }

    // Footer
    ops.push("BT");
    ops.push("/F1 8 Tf");
    ops.push(`54 34 Td`);
    ops.push(
      `(${escapePdfText(`Stamford University Bangladesh · EvalDesk · Page ${p + 1} of ${safePages.length}`)}) Tj`
    );
    ops.push("ET");

    const stream = ops.join("\n");
    pageEntries.push({ pageObj, contentObj, stream });
  }

  objects.push(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pageObjNums.length} >>\nendobj\n`
  );
  objects.push(
    "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
  );
  objects.push(
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n"
  );

  for (const entry of pageEntries) {
    objects.push(
      `${entry.pageObj} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${entry.contentObj} 0 R >>\nendobj\n`
    );
    const streamLen = Buffer.byteLength(entry.stream, "latin1");
    objects.push(
      `${entry.contentObj} 0 obj\n<< /Length ${streamLen} >>\nstream\n${entry.stream}\nendstream\nendobj\n`
    );
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

