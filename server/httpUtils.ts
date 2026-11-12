import type { IncomingMessage, ServerResponse } from "node:http";

export interface ParsedFile {
  fieldName: string;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export interface MultipartResult {
  fields: Record<string, string>;
  files: ParsedFile[];
}

export async function readBodyBuffer(req: IncomingMessage, maxBytes = 25 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("Payload exceeds maximum allowed upload size (25 MB).");
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const buf = await readBodyBuffer(req, 2 * 1024 * 1024);
  if (buf.length === 0) return {} as T;
  try {
    return JSON.parse(buf.toString("utf8")) as T;
  } catch {
    throw new Error("Invalid JSON request body.");
  }
}

export async function readMultipartBody(req: IncomingMessage): Promise<MultipartResult> {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    throw new Error("Expected multipart/form-data request.");
  }
  const boundary = (match[1] || match[2]).trim();
  const body = await readBodyBuffer(req, 25 * 1024 * 1024);

  const boundaryBuf = Buffer.from(`--${boundary}`);
  const fields: Record<string, string> = {};
  const files: ParsedFile[] = [];

  let start = body.indexOf(boundaryBuf);
  if (start === -1) return { fields, files };

  while (start !== -1) {
    start += boundaryBuf.length;
    if (body.subarray(start, start + 2).equals(Buffer.from("--"))) break;
    if (body.subarray(start, start + 2).equals(Buffer.from("\r\n"))) start += 2;

    const nextBoundary = body.indexOf(boundaryBuf, start);
    if (nextBoundary === -1) break;

    const part = body.subarray(start, nextBoundary - 2); // strip trailing \r\n
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      start = nextBoundary;
      continue;
    }

    const headerStr = part.subarray(0, headerEnd).toString("utf8");
    const content = part.subarray(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/i);
    const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
    const mimeMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

    const fieldName = nameMatch?.[1] || "file";
    if (filenameMatch && filenameMatch[1]) {
      files.push({
        fieldName,
        originalName: filenameMatch[1].split(/[\\/]/).pop() || "upload.bin",
        mimeType: (mimeMatch?.[1] || "application/octet-stream").trim(),
        buffer: content,
      });
    } else {
      fields[fieldName] = content.toString("utf8");
    }

    start = nextBoundary;
  }

  return { fields, files };
}

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

export function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error });
}

export function csvEscape(val: unknown): string {
  const str = String(val ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

