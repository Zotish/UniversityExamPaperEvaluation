import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Role, UserRecord } from "./types.ts";

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, "hex");
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function createSession(db: DatabaseSync, userId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(
    token,
    userId,
    expiresAt
  );
  return { token, expiresAt };
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function extractToken(req: IncomingMessage): string | null {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers["cookie"];
  if (typeof cookieHeader === "string") {
    const cookies = cookieHeader.split(";").map((c) => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith("evaldesk_session=")) {
        return decodeURIComponent(cookie.slice("evaldesk_session=".length));
      }
    }
  }
  const urlStr = req.url || "";
  const qIndex = urlStr.indexOf("?");
  if (qIndex !== -1) {
    const params = new URLSearchParams(urlStr.slice(qIndex + 1));
    const tokenParam = params.get("token");
    if (tokenParam) return tokenParam;
  }
  return null;
}

export function getAuthenticatedUser(
  db: DatabaseSync,
  req: IncomingMessage
): Omit<UserRecord, "password_hash"> | null {
  const token = extractToken(req);
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.department, u.designation,
              u.student_id_number, u.teacher_id_number, u.avatar_initials, u.created_at, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token) as (Omit<UserRecord, "password_hash"> & { expires_at: string }) | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSession(db, token);
    return null;
  }

  const { expires_at: _, ...user } = row;
  return user;
}

export function hasRole(user: Omit<UserRecord, "password_hash"> | null, role: Role): boolean {
  return Boolean(user && user.role === role);
}

