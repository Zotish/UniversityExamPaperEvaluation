import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  createSession,
  deleteSession,
  extractToken,
  getAuthenticatedUser,
  hashPassword,
  verifyPassword,
} from "./auth.ts";
import { createNotification, getDb, getUploadDir, logAudit } from "./db.ts";
import { evaluateQuestionResponse, getAiCapabilities } from "./evaluator.ts";
import { csvEscape, readJsonBody, readMultipartBody, sendError, sendJson } from "./httpUtils.ts";
import { getOcrCapabilities, ocrProvider, parseQuestionChunks } from "./ocr.ts";
import { generatePdfBuffer } from "./pdf.ts";
import { seedDatabaseIfEmpty } from "./seed.ts";
import type { ExamStatus, QuestionType, RecheckStatus } from "./types.ts";

const ALLOWED_EXTS = new Set([".pdf", ".jpg", ".jpeg", ".png"]);
const ALLOWED_MIMES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const VALID_EXAM_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
  Draft: ["Draft", "Awaiting Answer Key", "Ready for Upload", "Archived"],
  "Awaiting Answer Key": ["Draft", "Awaiting Answer Key", "Ready for Upload", "Archived"],
  "Ready for Upload": ["Awaiting Answer Key", "Ready for Upload", "Processing", "Needs Review", "Archived"],
  Processing: ["Needs Review", "Ready to Publish", "Ready for Upload"],
  "Needs Review": ["Ready for Upload", "Processing", "Needs Review", "Ready to Publish", "Archived"],
  "Ready to Publish": ["Needs Review", "Ready to Publish", "Published", "Archived"],
  Published: ["Published", "Archived"],
  Archived: ["Draft", "Published", "Needs Review", "Archived"],
};

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function validateUploadFile(originalName: string, mimeType: string, sizeBytes: number): string | null {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_EXTS.has(ext) && !ALLOWED_MIMES.has(mimeType.toLowerCase())) {
    return `Unsupported file type (${originalName}). Allowed formats: PDF, JPG, JPEG, PNG.`;
  }
  if (sizeBytes <= 0) {
    return `File "${originalName}" is empty.`;
  }
  if (sizeBytes > MAX_FILE_SIZE) {
    return `File "${originalName}" exceeds the 20 MB limit.`;
  }
  return null;
}

function storePrivateFile(params: {
  db: ReturnType<typeof getDb>;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  uploadedBy: number;
  docKind: "answer_key" | "student_sheet";
  pageCount: number;
}): { id: number; sha256: string; storedName: string } {
  const sha256 = crypto.createHash("sha256").update(params.buffer).digest("hex");
  const safeName = params.originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${safeName}`;
  const dest = path.join(getUploadDir(), storedName);
  fs.writeFileSync(dest, params.buffer);

  const res = params.db
    .prepare(
      `INSERT INTO uploaded_documents (original_name, stored_name, mime_type, size_bytes, sha256, page_count, uploaded_by, doc_kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.originalName,
      storedName,
      params.mimeType,
      params.buffer.length,
      sha256,
      params.pageCount,
      params.uploadedBy,
      params.docKind
    );

  return { id: Number(res.lastInsertRowid), sha256, storedName };
}

function recalculateExamStatus(db: ReturnType<typeof getDb>, examId: number): ExamStatus {
  const exam = db.prepare("SELECT status, answer_key_verified FROM examinations WHERE id = ?").get(examId) as
    | { status: ExamStatus; answer_key_verified: number }
    | undefined;
  if (!exam) return "Draft";
  if (exam.status === "Published" || exam.status === "Archived") return exam.status;

  const subs = db
    .prepare("SELECT review_status FROM submissions WHERE exam_id = ? AND upload_status = 'Uploaded'")
    .all(examId) as { review_status: string }[];

  let nextStatus: ExamStatus = exam.status;
  if (subs.length === 0) {
    nextStatus = exam.answer_key_verified ? "Ready for Upload" : "Awaiting Answer Key";
  } else if (subs.every((s) => s.review_status === "Teacher Approved")) {
    nextStatus = "Ready to Publish";
  } else {
    nextStatus = "Needs Review";
  }

  if (nextStatus !== exam.status) {
    db.prepare("UPDATE examinations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
      nextStatus,
      examId
    );
  }
  return nextStatus;
}

export async function handleApiRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const rawUrl = req.url || "/";
  const urlObj = new URL(rawUrl, "http://localhost");
  const pathname = urlObj.pathname;

  if (!pathname.startsWith("/api/")) {
    return false;
  }

  const db = getDb();
  seedDatabaseIfEmpty(db);

  const method = (req.method || "GET").toUpperCase();

  try {
    // -----------------------------------------------------------------------
    // 1. Health & Capabilities
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/health") {
      sendJson(res, 200, {
        status: "ok",
        ocr: getOcrCapabilities(),
        ai: getAiCapabilities(),
      });
      return true;
    }

    // -----------------------------------------------------------------------
    // 2. Authentication
    // -----------------------------------------------------------------------
    if (method === "POST" && pathname === "/api/auth/login") {
      const body = await readJsonBody<{
        email?: string;
        password?: string;
        demoRole?: "teacher" | "student";
      }>(req);

      let userRow:
        | {
            id: number;
            email: string;
            password_hash: string;
            name: string;
            role: "teacher" | "student";
            department: string;
            designation: string | null;
            student_id_number: string | null;
            avatar_initials: string;
          }
        | undefined;

      if (body.demoRole === "teacher") {
        userRow = db
          .prepare("SELECT * FROM users WHERE role = 'teacher' ORDER BY id ASC LIMIT 1")
          .get() as typeof userRow;
      } else if (body.demoRole === "student") {
        userRow = db
          .prepare("SELECT * FROM users WHERE role = 'student' ORDER BY id ASC LIMIT 1")
          .get() as typeof userRow;
      } else {
        const email = (body.email || "").trim().toLowerCase();
        const password = body.password || "";
        if (!email || !password) {
          sendError(res, 400, "Email and password are required.");
          return true;
        }
        userRow = db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(email) as typeof userRow;
        if (!userRow || !verifyPassword(password, userRow.password_hash)) {
          sendError(res, 401, "Invalid university email or password.");
          return true;
        }
      }

      if (!userRow) {
        sendError(res, 404, "User account not found.");
        return true;
      }

      const session = createSession(db, userRow.id);
      const { password_hash: _, ...safeUser } = userRow;
      res.setHeader(
        "Set-Cookie",
        `evaldesk_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
      );
      sendJson(res, 200, {
        token: session.token,
        user: safeUser,
        ocr: getOcrCapabilities(),
        ai: getAiCapabilities(),
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/auth/register") {
      const body = await readJsonBody<{
        role?: "teacher" | "student";
        name?: string;
        email?: string;
        password?: string;
        department?: string;
        designation?: string;
        studentIdNumber?: string;
        teacherIdNumber?: string;
        inviteCode?: string;
      }>(req);

      const role = body.role;
      if (role !== "teacher" && role !== "student") {
        sendError(res, 400, "Account role must be either 'student' or 'teacher'.");
        return true;
      }

      const name = (body.name || "").trim();
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";
      const department = (body.department || "Computer Science and Engineering").trim();

      if (name.length < 2) {
        sendError(res, 400, "Full name must be at least 2 characters.");
        return true;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        sendError(res, 400, "Please enter a valid university email address.");
        return true;
      }
      if (password.length < 8) {
        sendError(res, 400, "Password must be at least 8 characters long.");
        return true;
      }

      const existingEmail = db
        .prepare("SELECT id FROM users WHERE lower(email) = ?")
        .get(email) as { id: number } | undefined;
      if (existingEmail) {
        sendError(res, 409, "An account with this email address already exists.");
        return true;
      }

      const initials = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || "")
        .join("") || "ED";

      const passHash = hashPassword(password);

      if (role === "student") {
        const studentIdNumber = (body.studentIdNumber || "").trim().toUpperCase();
        if (studentIdNumber.length < 4) {
          sendError(res, 400, "Valid Student ID is required (e.g. CSE22006).");
          return true;
        }
        const matchesFacultyId = db
          .prepare("SELECT id FROM faculty_registry WHERE upper(teacher_id_number) = ?")
          .get(studentIdNumber) as { id: number } | undefined;
        if (matchesFacultyId || studentIdNumber.startsWith("FAC-")) {
          sendError(res, 400, "Faculty Teacher IDs cannot be used for student registration.");
          return true;
        }
        const existingSid = db
          .prepare("SELECT id FROM users WHERE upper(student_id_number) = ?")
          .get(studentIdNumber) as { id: number } | undefined;
        if (existingSid) {
          sendError(res, 409, `Student ID ${studentIdNumber} is already registered.`);
          return true;
        }

        const insertRes = db
          .prepare(
            `INSERT INTO users (email, password_hash, name, role, department, designation, student_id_number, teacher_id_number, avatar_initials)
             VALUES (?, ?, ?, 'student', ?, 'Undergraduate Student', ?, NULL, ?)`
          )
          .run(email, passHash, name, department, studentIdNumber, initials);
        const newUserId = Number(insertRes.lastInsertRowid);

        logAudit(db, {
          entityType: "user",
          entityId: newUserId,
          action: "student_registered",
          actorId: newUserId,
          actorName: name,
          details: { studentIdNumber, department },
        });

        const safeUser = db
          .prepare(
            `SELECT id, email, name, role, department, designation, student_id_number, teacher_id_number, avatar_initials, created_at
             FROM users WHERE id = ?`
          )
          .get(newUserId);
        const session = createSession(db, newUserId);
        res.setHeader(
          "Set-Cookie",
          `evaldesk_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
        );
        sendJson(res, 201, {
          token: session.token,
          user: safeUser,
          ocr: getOcrCapabilities(),
          ai: getAiCapabilities(),
        });
        return true;
      }

      // Teacher registration: requires valid unclaimed institutional Teacher ID in faculty_registry
      const teacherIdNumber = (body.teacherIdNumber || "").trim().toUpperCase();
      if (!teacherIdNumber) {
        sendError(res, 400, "Institutional Teacher ID is required for faculty registration.");
        return true;
      }

      const expectedInvite = process.env.FACULTY_INVITE_CODE;
      if (expectedInvite && (body.inviteCode || "").trim() !== expectedInvite) {
        sendError(res, 403, "Invalid faculty verification code.");
        return true;
      }

      const registryRow = db
        .prepare("SELECT * FROM faculty_registry WHERE upper(teacher_id_number) = ?")
        .get(teacherIdNumber) as
        | {
            id: number;
            teacher_id_number: string;
            full_name: string | null;
            expected_email: string | null;
            department: string;
            designation: string;
            claimed_by_user_id: number | null;
          }
        | undefined;

      if (!registryRow) {
        logAudit(db, {
          entityType: "security",
          entityId: 0,
          action: "teacher_signup_rejected",
          actorId: null,
          actorName: email,
          details: { reason: "unregistered_teacher_id", attemptedTeacherId: teacherIdNumber },
        });
        sendError(
          res,
          403,
          "Teacher ID is not in the institutional faculty registry. Students cannot register as faculty."
        );
        return true;
      }

      if (registryRow.claimed_by_user_id !== null) {
        sendError(res, 409, "This Teacher ID has already been claimed by an existing faculty account.");
        return true;
      }

      if (registryRow.expected_email && registryRow.expected_email.toLowerCase() !== email) {
        sendError(res, 403, "This Teacher ID is assigned to a different university email address.");
        return true;
      }

      const designation = (body.designation || registryRow.designation || "Lecturer").trim();
      const dept = department || registryRow.department;

      let newTeacherId = 0;
      db.exec("BEGIN IMMEDIATE;");
      try {
        const insertRes = db
          .prepare(
            `INSERT INTO users (email, password_hash, name, role, department, designation, student_id_number, teacher_id_number, avatar_initials)
             VALUES (?, ?, ?, 'teacher', ?, ?, NULL, ?, ?)`
          )
          .run(email, passHash, name, dept, designation, registryRow.teacher_id_number, initials);
        newTeacherId = Number(insertRes.lastInsertRowid);

        const claimRes = db
          .prepare(
            `UPDATE faculty_registry
             SET claimed_by_user_id = ?, full_name = COALESCE(full_name, ?)
             WHERE id = ? AND claimed_by_user_id IS NULL`
          )
          .run(newTeacherId, name, registryRow.id);

        if (claimRes.changes !== 1) {
          throw new Error("Teacher ID was already claimed.");
        }
        db.exec("COMMIT;");
      } catch (txErr) {
        db.exec("ROLLBACK;");
        sendError(
          res,
          409,
          txErr instanceof Error ? txErr.message : "Could not claim Teacher ID."
        );
        return true;
      }

      logAudit(db, {
        entityType: "user",
        entityId: newTeacherId,
        action: "teacher_registered",
        actorId: newTeacherId,
        actorName: name,
        details: { teacherIdNumber: registryRow.teacher_id_number, department: dept },
      });

      const safeUser = db
        .prepare(
          `SELECT id, email, name, role, department, designation, student_id_number, teacher_id_number, avatar_initials, created_at
           FROM users WHERE id = ?`
        )
        .get(newTeacherId);
      const session = createSession(db, newTeacherId);
      res.setHeader(
        "Set-Cookie",
        `evaldesk_session=${encodeURIComponent(session.token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`
      );
      sendJson(res, 201, {
        token: session.token,
        user: safeUser,
        ocr: getOcrCapabilities(),
        ai: getAiCapabilities(),
      });
      return true;
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      const token = extractToken(req);
      if (token) deleteSession(db, token);
      res.setHeader("Set-Cookie", "evaldesk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      sendJson(res, 200, { ok: true });
      return true;
    }

    const user = getAuthenticatedUser(db, req);
    if (!user) {
      sendError(res, 401, "Authentication required. Please sign in.");
      return true;
    }

    if (method === "GET" && pathname === "/api/auth/me") {
      sendJson(res, 200, {
        user,
        ocr: getOcrCapabilities(),
        ai: getAiCapabilities(),
      });
      return true;
    }

    // -----------------------------------------------------------------------
    // 3. Notifications & Audit
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/notifications") {
      const items = db
        .prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 30")
        .all(user.id);
      sendJson(res, 200, { notifications: items });
      return true;
    }

    if (method === "POST" && pathname === "/api/notifications/read-all") {
      db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(user.id);
      sendJson(res, 200, { ok: true });
      return true;
    }

    const notifReadMatch = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (method === "POST" && notifReadMatch) {
      db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?").run(
        Number(notifReadMatch[1]),
        user.id
      );
      sendJson(res, 200, { ok: true });
      return true;
    }

    if (method === "GET" && pathname === "/api/audit") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can view system audit logs.");
        return true;
      }
      const logs = db
        .prepare("SELECT * FROM audit_history ORDER BY created_at DESC, id DESC LIMIT 40")
        .all();
      sendJson(res, 200, { logs });
      return true;
    }

    if (method === "GET" && pathname === "/api/teacher/faculty-registry") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Teacher access required.");
        return true;
      }
      const items = db
        .prepare(
          `SELECT fr.*, u.email as claimed_email, u.name as claimed_name
           FROM faculty_registry fr
           LEFT JOIN users u ON u.id = fr.claimed_by_user_id
           ORDER BY fr.id ASC`
        )
        .all();
      sendJson(res, 200, { facultyIds: items });
      return true;
    }

    if (method === "POST" && pathname === "/api/teacher/faculty-registry") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Teacher access required.");
        return true;
      }
      const body = await readJsonBody<{
        teacherIdNumber?: string;
        expectedEmail?: string;
        department?: string;
        designation?: string;
      }>(req);

      const tid = (body.teacherIdNumber || "").trim().toUpperCase();
      if (!/^FAC-[A-Z0-9-]{3,}$/.test(tid)) {
        sendError(res, 400, "Teacher ID must follow institutional format (e.g. FAC-CSE-105).");
        return true;
      }
      const existing = db
        .prepare("SELECT id FROM faculty_registry WHERE upper(teacher_id_number) = ?")
        .get(tid);
      if (existing) {
        sendError(res, 409, `Teacher ID ${tid} already exists in the faculty registry.`);
        return true;
      }

      const expectedEmail = body.expectedEmail?.trim().toLowerCase() || null;
      const dept = (body.department || user.department || "Computer Science and Engineering").trim();
      const designation = (body.designation || "Lecturer").trim();

      const ins = db
        .prepare(
          `INSERT INTO faculty_registry (teacher_id_number, expected_email, department, designation)
           VALUES (?, ?, ?, ?)`
        )
        .run(tid, expectedEmail, dept, designation);

      logAudit(db, {
        entityType: "faculty_registry",
        entityId: Number(ins.lastInsertRowid),
        action: "faculty_id_issued",
        actorId: user.id,
        actorName: user.name,
        details: { teacherIdNumber: tid, expectedEmail },
      });

      sendJson(res, 201, {
        item: db
          .prepare("SELECT * FROM faculty_registry WHERE id = ?")
          .get(Number(ins.lastInsertRowid)),
      });
      return true;
    }

    // -----------------------------------------------------------------------
    // 4. Students Roster (Teacher only)
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/students") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Forbidden.");
        return true;
      }
      const courseId = urlObj.searchParams.get("courseId");
      let rows;
      if (courseId) {
        rows = db
          .prepare(
            `SELECT u.id, u.name, u.email, u.student_id_number, u.department, u.avatar_initials
             FROM course_enrollments ce
             JOIN users u ON u.id = ce.student_id
             WHERE ce.course_id = ? AND u.role = 'student'
             ORDER BY u.student_id_number ASC`
          )
          .all(Number(courseId));
      } else {
        rows = db
          .prepare(
            `SELECT id, name, email, student_id_number, department, avatar_initials
             FROM users WHERE role = 'student' ORDER BY student_id_number ASC`
          )
          .all();
      }
      sendJson(res, 200, { students: rows });
      return true;
    }

    // -----------------------------------------------------------------------
    // 5. Teacher & Student Dashboards
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/teacher/dashboard") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Teacher access required.");
        return true;
      }

      const activeCourses = (
        db.prepare("SELECT COUNT(*) as c FROM courses WHERE teacher_id = ?").get(user.id) as { c: number }
      ).c;

      const exams = db
        .prepare(
          `SELECT e.*, c.code as course_code, c.title as course_title, c.semester,
            (SELECT COUNT(*) FROM submissions s WHERE s.exam_id = e.id AND s.upload_status = 'Uploaded') as submission_count,
            (SELECT COUNT(*) FROM submissions s WHERE s.exam_id = e.id AND s.review_status = 'Teacher Approved') as approved_count,
            (SELECT COUNT(*) FROM submissions s WHERE s.exam_id = e.id AND s.review_status != 'Teacher Approved' AND s.upload_status = 'Uploaded') as pending_review_count
           FROM examinations e
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = ?
           ORDER BY e.updated_at DESC, e.id DESC`
        )
        .all(user.id) as Record<string, unknown>[];

      const totalExaminations = exams.filter((e) => e.status !== "Archived").length;
      const publishedResults = exams.filter((e) => e.status === "Published").length;

      const studentsEvaluated = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM submissions s
             JOIN examinations e ON e.id = s.exam_id
             JOIN courses c ON c.id = e.course_id
             WHERE c.teacher_id = ? AND s.review_status = 'Teacher Approved'`
          )
          .get(user.id) as { c: number }
      ).c;

      const scriptsNeedingReview = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM submissions s
             JOIN examinations e ON e.id = s.exam_id
             JOIN courses c ON c.id = e.course_id
             WHERE c.teacher_id = ? AND s.upload_status = 'Uploaded' AND s.review_status != 'Teacher Approved'`
          )
          .get(user.id) as { c: number }
      ).c;

      const openRechecksCount = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM recheck_requests rr
             JOIN examinations e ON e.id = rr.exam_id
             JOIN courses c ON c.id = e.course_id
             WHERE c.teacher_id = ? AND rr.status IN ('Submitted', 'Under Review')`
          )
          .get(user.id) as { c: number }
      ).c;

      const pendingEvaluations = exams.filter((e) =>
        ["Awaiting Answer Key", "Ready for Upload", "Processing", "Needs Review"].includes(
          String(e.status)
        )
      ).length;

      // Detailed pending work items
      const pendingWork: {
        id: string;
        category: string;
        title: string;
        subtitle: string;
        targetScreen: string;
        examId?: number;
        submissionId?: number;
        tone: "amber" | "red" | "blue";
      }[] = [];

      for (const ex of exams) {
        if (ex.status === "Awaiting Answer Key" || !ex.answer_key_verified) {
          pendingWork.push({
            id: `key-${ex.id}`,
            category: "Missing Answer Key",
            title: String(ex.title),
            subtitle: `${ex.course_code} · Answer key verification required`,
            targetScreen: "key",
            examId: Number(ex.id),
            tone: "amber",
          });
        } else if (ex.status === "Ready for Upload") {
          pendingWork.push({
            id: `upload-${ex.id}`,
            category: "Awaiting Scripts",
            title: String(ex.title),
            subtitle: `${ex.course_code} · Answer key verified, upload student sheets`,
            targetScreen: "sheets",
            examId: Number(ex.id),
            tone: "blue",
          });
        }
      }

      const flaggedQuestions = db
        .prepare(
          `SELECT qe.id, qe.submission_id, qe.review_status, q.question_number,
                  s.detected_student_name, s.detected_student_id, e.id as exam_id, c.code as course_code
           FROM question_evaluations qe
           JOIN submissions s ON s.id = qe.submission_id
           JOIN questions q ON q.id = qe.question_id
           JOIN examinations e ON e.id = s.exam_id
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = ? AND qe.review_status != 'Teacher Approved'
           ORDER BY qe.flagged DESC, qe.id DESC
           LIMIT 8`
        )
        .all(user.id) as Record<string, unknown>[];

      for (const fq of flaggedQuestions) {
        pendingWork.push({
          id: `qe-${fq.id}`,
          category: String(fq.review_status),
          title: `${fq.detected_student_name || "Unmatched Script"} · Q${fq.question_number}`,
          subtitle: `${fq.course_code} · ${fq.detected_student_id || "Needs identity check"}`,
          targetScreen: "review",
          examId: Number(fq.exam_id),
          submissionId: Number(fq.submission_id),
          tone: fq.review_status === "Extraction Uncertain" ? "red" : "amber",
        });
      }

      const openRechecks = db
        .prepare(
          `SELECT rr.id, rr.exam_id, rr.status, u.name as student_name, u.student_id_number,
                  q.question_number, c.code as course_code
           FROM recheck_requests rr
           JOIN users u ON u.id = rr.student_id
           JOIN questions q ON q.id = rr.question_id
           JOIN examinations e ON e.id = rr.exam_id
           JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = ? AND rr.status IN ('Submitted', 'Under Review')
           ORDER BY rr.created_at DESC LIMIT 5`
        )
        .all(user.id) as Record<string, unknown>[];

      for (const rc of openRechecks) {
        pendingWork.push({
          id: `rc-${rc.id}`,
          category: "Recheck Request",
          title: `${rc.student_name} (${rc.student_id_number}) · Q${rc.question_number}`,
          subtitle: `${rc.course_code} · Status: ${rc.status}`,
          targetScreen: "teacherRechecks",
          examId: Number(rc.exam_id),
          tone: "blue",
        });
      }

      const recentActivity = db
        .prepare("SELECT * FROM audit_history ORDER BY created_at DESC, id DESC LIMIT 10")
        .all();

      sendJson(res, 200, {
        metrics: {
          activeCourses,
          totalExaminations,
          pendingEvaluations,
          studentsEvaluated,
          scriptsNeedingReview,
          publishedResults,
          openRechecksCount,
        },
        recentExams: exams.slice(0, 6),
        pendingWork: pendingWork.slice(0, 10),
        recentActivity,
      });
      return true;
    }

    if (method === "GET" && pathname === "/api/student/dashboard") {
      if (user.role !== "student") {
        sendError(res, 403, "Student access required.");
        return true;
      }

      const enrolledCourses = db
        .prepare(
          `SELECT c.*, u.name as teacher_name
           FROM course_enrollments ce
           JOIN courses c ON c.id = ce.course_id
           JOIN users u ON u.id = c.teacher_id
           WHERE ce.student_id = ?
           ORDER BY c.semester DESC, c.code ASC`
        )
        .all(user.id) as Record<string, unknown>[];

      const examRows = db
        .prepare(
          `SELECT e.id, e.title, e.exam_date, e.total_marks, e.status, e.published_at,
                  c.code as course_code, c.title as course_title, c.semester,
                  u.name as teacher_name,
                  s.id as submission_id,
                  CASE WHEN e.status = 'Published' THEN s.total_approved_marks ELSE NULL END as obtained_marks,
                  CASE WHEN e.status = 'Published' THEN s.teacher_overall_feedback ELSE NULL END as teacher_overall_feedback
           FROM examinations e
           JOIN courses c ON c.id = e.course_id
           JOIN course_enrollments ce ON ce.course_id = c.id AND ce.student_id = ?
           JOIN users u ON u.id = c.teacher_id
           LEFT JOIN submissions s ON s.exam_id = e.id AND s.student_id = ?
           WHERE e.status != 'Archived'
           ORDER BY e.exam_date DESC, e.id DESC`
        )
        .all(user.id, user.id) as Record<string, unknown>[];

      const published = examRows.filter((e) => e.status === "Published" && e.submission_id);
      const pending = examRows.filter((e) => e.status !== "Published");
      const recheckCount = (
        db
          .prepare("SELECT COUNT(*) as c FROM recheck_requests WHERE student_id = ?")
          .get(user.id) as { c: number }
      ).c;

      sendJson(res, 200, {
        metrics: {
          enrolledCourses: enrolledCourses.length,
          publishedResults: published.length,
          pendingResults: pending.length,
          feedbackAvailable: published.length,
          recheckRequests: recheckCount,
        },
        courses: enrolledCourses,
        exams: examRows,
      });
      return true;
    }

    // -----------------------------------------------------------------------
    // 6. Courses
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/courses") {
      if (user.role === "teacher") {
        const courses = db
          .prepare(
            `SELECT c.*, u.name as teacher_name,
              (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id) as enrolled_count,
              (SELECT COUNT(*) FROM examinations e WHERE e.course_id = c.id AND e.status != 'Archived') as exam_count
             FROM courses c
             JOIN users u ON u.id = c.teacher_id
             WHERE c.teacher_id = ?
             ORDER BY c.semester DESC, c.code ASC`
          )
          .all(user.id);
        sendJson(res, 200, { courses });
      } else {
        const courses = db
          .prepare(
            `SELECT c.*, u.name as teacher_name,
              (SELECT COUNT(*) FROM examinations e WHERE e.course_id = c.id AND e.status != 'Archived') as exam_count,
              (SELECT COUNT(*) FROM examinations e WHERE e.course_id = c.id AND e.status = 'Published') as published_exam_count
             FROM course_enrollments ce
             JOIN courses c ON c.id = ce.course_id
             JOIN users u ON u.id = c.teacher_id
             WHERE ce.student_id = ?
             ORDER BY c.semester DESC, c.code ASC`
          )
          .all(user.id);
        sendJson(res, 200, { courses });
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/courses") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can create courses.");
        return true;
      }
      const body = await readJsonBody<{
        code?: string;
        title?: string;
        department?: string;
        semester?: string;
        description?: string;
        enrollAllDemoStudents?: boolean;
      }>(req);

      const code = (body.code || "").trim();
      const title = (body.title || "").trim();
      const department = (body.department || "Computer Science and Engineering").trim();
      const semester = (body.semester || "Fall 2026").trim();
      const description = (body.description || "").trim();

      if (!code || !title) {
        sendError(res, 400, "Course code and course title are required.");
        return true;
      }

      const resInsert = db
        .prepare(
          `INSERT INTO courses (code, title, department, semester, teacher_id, description)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(code, title, department, semester, user.id, description);
      const courseId = Number(resInsert.lastInsertRowid);

      if (body.enrollAllDemoStudents !== false) {
        const allStudents = db.prepare("SELECT id FROM users WHERE role = 'student'").all() as {
          id: number;
        }[];
        const insEnroll = db.prepare(
          "INSERT OR IGNORE INTO course_enrollments (course_id, student_id) VALUES (?, ?)"
        );
        for (const s of allStudents) insEnroll.run(courseId, s.id);
      }

      logAudit(db, {
        entityType: "course",
        entityId: courseId,
        action: "Course created",
        actorId: user.id,
        actorName: user.name,
        details: { code, title, semester },
      });

      const created = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
      sendJson(res, 201, { course: created });
      return true;
    }

    const courseDetailMatch = pathname.match(/^\/api\/courses\/(\d+)$/);
    if (courseDetailMatch) {
      const courseId = Number(courseDetailMatch[1]);
      const course = db
        .prepare(
          `SELECT c.*, u.name as teacher_name
           FROM courses c JOIN users u ON u.id = c.teacher_id
           WHERE c.id = ?`
        )
        .get(courseId) as Record<string, unknown> | undefined;

      if (!course) {
        sendError(res, 404, "Course not found.");
        return true;
      }

      if (user.role === "student") {
        const enrolled = db
          .prepare("SELECT 1 FROM course_enrollments WHERE course_id = ? AND student_id = ?")
          .get(courseId, user.id);
        if (!enrolled) {
          sendError(res, 403, "You are not enrolled in this course.");
          return true;
        }
      } else if (Number(course.teacher_id) !== user.id) {
        sendError(res, 403, "Forbidden.");
        return true;
      }

      if (method === "GET") {
        const exams = db
          .prepare("SELECT * FROM examinations WHERE course_id = ? ORDER BY exam_date DESC, id DESC")
          .all(courseId);
        const students =
          user.role === "teacher"
            ? db
                .prepare(
                  `SELECT u.id, u.name, u.email, u.student_id_number, u.avatar_initials
                   FROM course_enrollments ce JOIN users u ON u.id = ce.student_id
                   WHERE ce.course_id = ? ORDER BY u.student_id_number ASC`
                )
                .all(courseId)
            : [];
        sendJson(res, 200, { course, exams, students });
        return true;
      }

      if (method === "PUT") {
        if (user.role !== "teacher") {
          sendError(res, 403, "Only teachers can edit courses.");
          return true;
        }
        const body = await readJsonBody<{
          code?: string;
          title?: string;
          department?: string;
          semester?: string;
          description?: string;
        }>(req);

        db.prepare(
          `UPDATE courses
           SET code = COALESCE(?, code),
               title = COALESCE(?, title),
               department = COALESCE(?, department),
               semester = COALESCE(?, semester),
               description = COALESCE(?, description)
           WHERE id = ?`
        ).run(
          body.code?.trim() || null,
          body.title?.trim() || null,
          body.department?.trim() || null,
          body.semester?.trim() || null,
          body.description !== undefined ? body.description.trim() : null,
          courseId
        );

        const updated = db.prepare("SELECT * FROM courses WHERE id = ?").get(courseId);
        sendJson(res, 200, { course: updated });
        return true;
      }
    }

    // -----------------------------------------------------------------------
    // 7. Examinations
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/exams") {
      if (user.role === "teacher") {
        const exams = db
          .prepare(
            `SELECT e.*, c.code as course_code, c.title as course_title, c.semester,
              (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as configured_questions,
              (SELECT COUNT(*) FROM submissions s WHERE s.exam_id = e.id AND s.upload_status = 'Uploaded') as submission_count,
              (SELECT COUNT(*) FROM submissions s WHERE s.exam_id = e.id AND s.review_status = 'Teacher Approved') as approved_count
             FROM examinations e
             JOIN courses c ON c.id = e.course_id
             WHERE c.teacher_id = ?
             ORDER BY e.updated_at DESC, e.id DESC`
          )
          .all(user.id);
        sendJson(res, 200, { exams });
      } else {
        const exams = db
          .prepare(
            `SELECT e.id, e.course_id, e.title, e.exam_date, e.total_marks, e.status, e.published_at,
                    c.code as course_code, c.title as course_title, c.semester,
                    s.id as submission_id,
                    CASE WHEN e.status = 'Published' THEN s.total_approved_marks ELSE NULL END as obtained_marks
             FROM examinations e
             JOIN courses c ON c.id = e.course_id
             JOIN course_enrollments ce ON ce.course_id = c.id AND ce.student_id = ?
             LEFT JOIN submissions s ON s.exam_id = e.id AND s.student_id = ?
             WHERE e.status != 'Archived'
             ORDER BY e.exam_date DESC, e.id DESC`
          )
          .all(user.id, user.id);
        sendJson(res, 200, { exams });
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/exams") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can create examinations.");
        return true;
      }
      const body = await readJsonBody<{
        courseId?: number;
        title?: string;
        examDate?: string;
        totalMarks?: number;
        passThreshold?: number;
        totalQuestions?: number;
        status?: ExamStatus;
      }>(req);

      const courseId = Number(body.courseId);
      const title = (body.title || "").trim();
      const examDate = (body.examDate || new Date().toISOString().slice(0, 10)).trim();
      const totalMarks = Number(body.totalMarks);
      const passThreshold = Number(body.passThreshold ?? 40);
      const totalQuestions = Math.max(1, Number(body.totalQuestions ?? 5));
      const status: ExamStatus = body.status === "Draft" ? "Draft" : "Awaiting Answer Key";

      if (!courseId || !title || !Number.isFinite(totalMarks) || totalMarks <= 0) {
        sendError(res, 400, "Valid course, examination title, and positive total marks are required.");
        return true;
      }

      const course = db
        .prepare("SELECT id, teacher_id FROM courses WHERE id = ?")
        .get(courseId) as { id: number; teacher_id: number } | undefined;
      if (!course || course.teacher_id !== user.id) {
        sendError(res, 403, "Course not found or unauthorized.");
        return true;
      }

      const resIns = db
        .prepare(
          `INSERT INTO examinations (course_id, title, exam_date, total_marks, pass_threshold, total_questions, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(courseId, title, examDate, totalMarks, passThreshold, totalQuestions, status, user.id);

      const examId = Number(resIns.lastInsertRowid);

      // Pre-populate starter question slots so the Answer Key editor is immediately structured
      const perMark = Math.floor((totalMarks / totalQuestions) * 10) / 10;
      const insQ = db.prepare(
        `INSERT INTO questions (exam_id, question_number, question_text, question_type, max_marks, reference_answer, topic, page_number)
         VALUES (?, ?, ?, 'Short Answer', ?, '', 'General', 1)`
      );
      const insRub = db.prepare(
        `INSERT INTO marking_rubrics (question_id, criterion_name, max_marks, sort_order) VALUES (?, 'Core Concept Accuracy', ?, 0)`
      );
      let allocated = 0;
      for (let i = 1; i <= totalQuestions; i++) {
        const qMark = i === totalQuestions ? Number((totalMarks - allocated).toFixed(2)) : perMark;
        allocated += qMark;
        const qRes = insQ.run(examId, i, `Question ${i}`, qMark);
        insRub.run(Number(qRes.lastInsertRowid), qMark);
      }

      logAudit(db, {
        entityType: "exam",
        entityId: examId,
        action: "Examination created",
        actorId: user.id,
        actorName: user.name,
        details: { title, totalMarks, status },
      });

      const exam = db.prepare("SELECT * FROM examinations WHERE id = ?").get(examId);
      sendJson(res, 201, { exam });
      return true;
    }

    const examMatch = pathname.match(/^\/api\/exams\/(\d+)$/);
    if (examMatch) {
      const examId = Number(examMatch[1]);
      const exam = db
        .prepare(
          `SELECT e.*, c.code as course_code, c.title as course_title, c.department, c.semester, c.teacher_id,
                  u.name as teacher_name,
                  d.original_name as answer_key_file_name, d.mime_type as answer_key_mime, d.size_bytes as answer_key_size, d.page_count as answer_key_pages
           FROM examinations e
           JOIN courses c ON c.id = e.course_id
           JOIN users u ON u.id = c.teacher_id
           LEFT JOIN uploaded_documents d ON d.id = e.answer_key_file_id
           WHERE e.id = ?`
        )
        .get(examId) as Record<string, unknown> | undefined;

      if (!exam) {
        sendError(res, 404, "Examination not found.");
        return true;
      }

      if (user.role === "teacher" && Number(exam.teacher_id) !== user.id) {
        sendError(res, 403, "Forbidden.");
        return true;
      }
      if (user.role === "student") {
        const enrolled = db
          .prepare("SELECT 1 FROM course_enrollments WHERE course_id = ? AND student_id = ?")
          .get(Number(exam.course_id), user.id);
        if (!enrolled) {
          sendError(res, 403, "Not enrolled in this course.");
          return true;
        }
      }

      if (method === "GET") {
        const rawQuestions = db
          .prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY question_number ASC")
          .all(examId) as Record<string, unknown>[];

        const questions = rawQuestions.map((q) => {
          const rubrics = db
            .prepare("SELECT * FROM marking_rubrics WHERE question_id = ? ORDER BY sort_order ASC, id ASC")
            .all(Number(q.id));
          return {
            ...q,
            reference_answer:
              user.role === "teacher" || exam.status === "Published" ? q.reference_answer : undefined,
            alternative_answers:
              user.role === "teacher" || exam.status === "Published"
                ? safeJsonParse<string[]>(String(q.alternative_answers_json), [])
                : [],
            rubrics,
          };
        });

        sendJson(res, 200, { exam, questions });
        return true;
      }

      if (method === "PUT") {
        if (user.role !== "teacher") {
          sendError(res, 403, "Only teachers can update examinations.");
          return true;
        }
        const body = await readJsonBody<{
          title?: string;
          courseId?: number;
          examDate?: string;
          totalMarks?: number;
          passThreshold?: number;
          totalQuestions?: number;
          status?: ExamStatus;
        }>(req);

        const currentStatus = String(exam.status) as ExamStatus;
        if (body.status && !VALID_EXAM_TRANSITIONS[currentStatus]?.includes(body.status)) {
          sendError(res, 400, `Invalid status transition from ${currentStatus} to ${body.status}.`);
          return true;
        }

        if (currentStatus === "Published" && body.totalMarks !== undefined && Number(body.totalMarks) !== Number(exam.total_marks)) {
          sendError(res, 400, "Cannot change total marks of a published examination.");
          return true;
        }

        db.prepare(
          `UPDATE examinations
           SET title = COALESCE(?, title),
               course_id = COALESCE(?, course_id),
               exam_date = COALESCE(?, exam_date),
               total_marks = COALESCE(?, total_marks),
               pass_threshold = COALESCE(?, pass_threshold),
               total_questions = COALESCE(?, total_questions),
               status = COALESCE(?, status),
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          body.title?.trim() || null,
          body.courseId ? Number(body.courseId) : null,
          body.examDate || null,
          body.totalMarks !== undefined ? Number(body.totalMarks) : null,
          body.passThreshold !== undefined ? Number(body.passThreshold) : null,
          body.totalQuestions !== undefined ? Number(body.totalQuestions) : null,
          body.status || null,
          examId
        );

        logAudit(db, {
          entityType: "exam",
          entityId: examId,
          action: body.status ? `Examination status changed to ${body.status}` : "Examination updated",
          actorId: user.id,
          actorName: user.name,
          details: body,
        });

        const updated = db.prepare("SELECT * FROM examinations WHERE id = ?").get(examId);
        sendJson(res, 200, { exam: updated });
        return true;
      }
    }

    // -----------------------------------------------------------------------
    // 8. Answer Key Upload & Questions/Rubric Editor
    // -----------------------------------------------------------------------
    const answerKeyUploadMatch = pathname.match(/^\/api\/exams\/(\d+)\/answer-key$/);
    if (method === "POST" && answerKeyUploadMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can upload answer keys.");
        return true;
      }
      const examId = Number(answerKeyUploadMatch[1]);
      const exam = db
        .prepare(
          `SELECT e.*, c.teacher_id FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`
        )
        .get(examId) as { id: number; teacher_id: number; status: ExamStatus } | undefined;

      if (!exam || exam.teacher_id !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }

      const { files } = await readMultipartBody(req);
      const file = files[0];
      if (!file) {
        sendError(res, 400, "No answer key file received.");
        return true;
      }

      const validationErr = validateUploadFile(file.originalName, file.mimeType, file.buffer.length);
      if (validationErr) {
        sendError(res, 400, validationErr);
        return true;
      }

      const stored = storePrivateFile({
        db,
        originalName: file.originalName,
        mimeType: file.mimeType,
        buffer: file.buffer,
        uploadedBy: user.id,
        docKind: "answer_key",
        pageCount: 1,
      });

      const filePath = path.join(getUploadDir(), stored.storedName);
      const extraction = await ocrProvider.extractDocument(filePath, file.mimeType);

      db.prepare("UPDATE uploaded_documents SET page_count = ? WHERE id = ?").run(
        extraction.pageCount,
        stored.id
      );
      db.prepare(
        `UPDATE examinations
         SET answer_key_file_id = ?,
             answer_key_verified = 0,
             status = CASE WHEN status = 'Draft' THEN 'Awaiting Answer Key' ELSE status END,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(stored.id, examId);

      // Parse suggested questions if selectable text was extracted
      const parsedChunks = extraction.fullText
        ? parseQuestionChunks(extraction.fullText, extraction.pageCount)
        : [];

      logAudit(db, {
        entityType: "exam",
        entityId: examId,
        action: "Answer key uploaded",
        actorId: user.id,
        actorName: user.name,
        details: { fileName: file.originalName, pageCount: extraction.pageCount, extractedChunks: parsedChunks.length },
      });

      const docRow = db.prepare("SELECT * FROM uploaded_documents WHERE id = ?").get(stored.id);
      sendJson(res, 200, {
        document: docRow,
        extraction,
        suggestedChunks: parsedChunks,
      });
      return true;
    }

    const questionsMatch = pathname.match(/^\/api\/exams\/(\d+)\/questions$/);
    if (method === "PUT" && questionsMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can edit questions and rubrics.");
        return true;
      }
      const examId = Number(questionsMatch[1]);
      const exam = db
        .prepare(
          `SELECT e.*, c.teacher_id FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`
        )
        .get(examId) as { id: number; teacher_id: number; total_marks: number; status: ExamStatus } | undefined;

      if (!exam || exam.teacher_id !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }
      if (exam.status === "Published") {
        sendError(res, 400, "Cannot modify questions or answer key of a published examination.");
        return true;
      }

      const body = await readJsonBody<{
        verify?: boolean;
        questions?: {
          question_number: number;
          question_text: string;
          question_type: QuestionType;
          max_marks: number;
          reference_answer: string;
          alternative_answers?: string[];
          numerical_tolerance?: number;
          topic?: string;
          page_number?: number;
          rubrics: { criterion_name: string; max_marks: number }[];
        }[];
      }>(req);

      const questions = body.questions || [];
      if (questions.length === 0) {
        sendError(res, 400, "At least one question is required.");
        return true;
      }

      // Validate rubric sums and question totals
      let totalQuestionMarks = 0;
      for (const q of questions) {
        const qMax = Number(q.max_marks);
        if (!q.question_text?.trim()) {
          sendError(res, 400, `Question ${q.question_number} text cannot be empty.`);
          return true;
        }
        if (!Number.isFinite(qMax) || qMax <= 0) {
          sendError(res, 400, `Question ${q.question_number} must have positive maximum marks.`);
          return true;
        }
        if (q.rubrics && q.rubrics.length > 0) {
          const rubricSum = q.rubrics.reduce((sum, r) => sum + Number(r.max_marks || 0), 0);
          if (Math.abs(rubricSum - qMax) > 0.01) {
            sendError(
              res,
              400,
              `Question ${q.question_number}: Rubric criteria sum (${rubricSum}) must equal question maximum marks (${qMax}).`
            );
            return true;
          }
          for (const r of q.rubrics) {
            if (!r.criterion_name?.trim()) {
              sendError(res, 400, `Question ${q.question_number}: Rubric criterion name cannot be empty.`);
              return true;
            }
          }
        }
        if (body.verify && !q.reference_answer?.trim()) {
          sendError(
            res,
            400,
            `Question ${q.question_number}: Official reference answer is required to verify the answer key.`
          );
          return true;
        }
        totalQuestionMarks += qMax;
      }

      if (body.verify && Math.abs(totalQuestionMarks - exam.total_marks) > 0.01) {
        sendError(
          res,
          400,
          `Total of all question marks (${totalQuestionMarks}) must equal the examination total (${exam.total_marks}) before verifying.`
        );
        return true;
      }

      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM questions WHERE exam_id = ?").run(examId);

        const insQ = db.prepare(
          `INSERT INTO questions (exam_id, question_number, question_text, question_type, max_marks, reference_answer, alternative_answers_json, numerical_tolerance, topic, page_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const insRub = db.prepare(
          `INSERT INTO marking_rubrics (question_id, criterion_name, max_marks, sort_order) VALUES (?, ?, ?, ?)`
        );

        for (let idx = 0; idx < questions.length; idx++) {
          const q = questions[idx];
          const qNum = idx + 1;
          const qRes = insQ.run(
            examId,
            qNum,
            q.question_text.trim(),
            q.question_type,
            Number(q.max_marks),
            (q.reference_answer || "").trim(),
            JSON.stringify((q.alternative_answers || []).map((a) => a.trim()).filter(Boolean)),
            Number(q.numerical_tolerance || 0),
            (q.topic || "General").trim(),
            Math.max(1, Number(q.page_number || 1))
          );
          const qId = Number(qRes.lastInsertRowid);
          const rubrics = q.rubrics?.length
            ? q.rubrics
            : [{ criterion_name: "Answer Accuracy", max_marks: Number(q.max_marks) }];
          rubrics.forEach((r, rIdx) => {
            insRub.run(qId, r.criterion_name.trim(), Number(r.max_marks), rIdx);
          });
        }

        const verified = body.verify ? 1 : 0;
        const nextStatus: ExamStatus = verified
          ? exam.status === "Draft" || exam.status === "Awaiting Answer Key"
            ? "Ready for Upload"
            : exam.status
          : exam.status === "Draft"
            ? "Awaiting Answer Key"
            : exam.status;

        db.prepare(
          `UPDATE examinations
           SET total_questions = ?,
               answer_key_verified = ?,
               status = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(questions.length, verified, nextStatus, examId);

        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }

      logAudit(db, {
        entityType: "exam",
        entityId: examId,
        action: body.verify ? "Answer key verified" : "Answer key draft saved",
        actorId: user.id,
        actorName: user.name,
        details: { questionCount: questions.length, totalQuestionMarks, verified: Boolean(body.verify) },
      });

      const savedQuestions = db
        .prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY question_number ASC")
        .all(examId) as Record<string, unknown>[];
      const withRubrics = savedQuestions.map((q) => ({
        ...q,
        alternative_answers: safeJsonParse<string[]>(String(q.alternative_answers_json), []),
        rubrics: db
          .prepare("SELECT * FROM marking_rubrics WHERE question_id = ? ORDER BY sort_order ASC")
          .all(Number(q.id)),
      }));
      const updatedExam = db.prepare("SELECT * FROM examinations WHERE id = ?").get(examId);

      sendJson(res, 200, { exam: updatedExam, questions: withRubrics });
      return true;
    }

    // -----------------------------------------------------------------------
    // 9. Bulk Student Answer Sheet Upload & Mapping
    // -----------------------------------------------------------------------
    const sheetsUploadMatch = pathname.match(/^\/api\/exams\/(\d+)\/sheets$/);
    if (method === "POST" && sheetsUploadMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can upload student answer sheets.");
        return true;
      }
      const examId = Number(sheetsUploadMatch[1]);
      const exam = db
        .prepare(
          `SELECT e.*, c.teacher_id FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`
        )
        .get(examId) as { id: number; course_id: number; teacher_id: number; status: ExamStatus } | undefined;

      if (!exam || exam.teacher_id !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }

      const { files } = await readMultipartBody(req);
      if (files.length === 0) {
        sendError(res, 400, "No student script files received.");
        return true;
      }

      const enrolledStudents = db
        .prepare(
          `SELECT u.id, u.name, u.student_id_number
           FROM course_enrollments ce JOIN users u ON u.id = ce.student_id
           WHERE ce.course_id = ? AND u.role = 'student'`
        )
        .all(exam.course_id) as { id: number; name: string; student_id_number: string }[];

      const results: {
        fileName: string;
        status: "Uploaded" | "Duplicate" | "Failed";
        message: string;
        submission?: unknown;
      }[] = [];

      for (const file of files) {
        const err = validateUploadFile(file.originalName, file.mimeType, file.buffer.length);
        if (err) {
          results.push({ fileName: file.originalName, status: "Failed", message: err });
          continue;
        }

        const sha256 = crypto.createHash("sha256").update(file.buffer).digest("hex");
        const existingDup = db
          .prepare(
            `SELECT s.id FROM submissions s
             JOIN uploaded_documents d ON d.id = s.document_id
             WHERE s.exam_id = ? AND (d.sha256 = ? OR lower(d.original_name) = lower(?))`
          )
          .get(examId, sha256, file.originalName);

        if (existingDup) {
          results.push({
            fileName: file.originalName,
            status: "Duplicate",
            message: `Duplicate file detected for this examination (${file.originalName}).`,
          });
          continue;
        }

        const stored = storePrivateFile({
          db,
          originalName: file.originalName,
          mimeType: file.mimeType,
          buffer: file.buffer,
          uploadedBy: user.id,
          docKind: "student_sheet",
          pageCount: 1,
        });

        const filePath = path.join(getUploadDir(), stored.storedName);
        const ocrPreview = await ocrProvider.extractDocument(filePath, file.mimeType);
        db.prepare("UPDATE uploaded_documents SET page_count = ? WHERE id = ?").run(
          ocrPreview.pageCount,
          stored.id
        );

        // Attempt conservative identity matching from filename or selectable PDF header; never guess silently
        const searchHaystack = `${file.originalName} ${ocrPreview.fullText.slice(0, 600)}`.toLowerCase();
        const matches = enrolledStudents.filter(
          (st) =>
            (st.student_id_number && searchHaystack.includes(st.student_id_number.toLowerCase())) ||
            searchHaystack.includes(st.name.toLowerCase())
        );

        const matchedStudent = matches.length === 1 ? matches[0] : null;
        const subRes = db
          .prepare(
            `INSERT INTO submissions (exam_id, student_id, document_id, detected_student_name, detected_student_id, upload_status, processing_status, review_status)
             VALUES (?, ?, ?, ?, ?, 'Uploaded', 'Pending', 'Pending')`
          )
          .run(
            examId,
            matchedStudent ? matchedStudent.id : null,
            stored.id,
            matchedStudent ? matchedStudent.name : "",
            matchedStudent ? matchedStudent.student_id_number : ""
          );

        const subRow = db
          .prepare(
            `SELECT s.*, d.original_name as file_name, d.mime_type, d.size_bytes, d.page_count
             FROM submissions s LEFT JOIN uploaded_documents d ON d.id = s.document_id
             WHERE s.id = ?`
          )
          .get(Number(subRes.lastInsertRowid));

        results.push({
          fileName: file.originalName,
          status: "Uploaded",
          message: matchedStudent
            ? `Matched to ${matchedStudent.name} (${matchedStudent.student_id_number}).`
            : "Uploaded. Student identity unclear — please select student manually.",
          submission: subRow,
        });
      }

      logAudit(db, {
        entityType: "exam",
        entityId: examId,
        action: "Student scripts uploaded",
        actorId: user.id,
        actorName: user.name,
        details: { totalFiles: files.length, uploaded: results.filter((r) => r.status === "Uploaded").length },
      });

      sendJson(res, 200, { results });
      return true;
    }

    const examSubsMatch = pathname.match(/^\/api\/exams\/(\d+)\/submissions$/);
    if (method === "GET" && examSubsMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can list all student submissions.");
        return true;
      }
      const examId = Number(examSubsMatch[1]);
      const exam = db
        .prepare("SELECT e.*, c.teacher_id FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?")
        .get(examId) as { id: number; teacher_id: number } | undefined;
      if (!exam || exam.teacher_id !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }

      const submissions = db
        .prepare(
          `SELECT s.*, u.name as student_name, u.student_id_number, u.avatar_initials,
                  d.original_name as file_name, d.mime_type, d.size_bytes, d.page_count,
                  (SELECT COUNT(*) FROM question_evaluations qe WHERE qe.submission_id = s.id AND qe.review_status != 'Teacher Approved') as unapproved_questions,
                  (SELECT COUNT(*) FROM question_evaluations qe WHERE qe.submission_id = s.id AND qe.flagged = 1) as flagged_questions
           FROM submissions s
           LEFT JOIN users u ON u.id = s.student_id
           LEFT JOIN uploaded_documents d ON d.id = s.document_id
           WHERE s.exam_id = ?
           ORDER BY COALESCE(u.student_id_number, s.detected_student_id, s.id) ASC`
        )
        .all(examId);

      sendJson(res, 200, { submissions });
      return true;
    }

    const subAssignMatch = pathname.match(/^\/api\/submissions\/(\d+)\/assign$/);
    if (method === "PUT" && subAssignMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can assign student identities.");
        return true;
      }
      const subId = Number(subAssignMatch[1]);
      const body = await readJsonBody<{ studentId?: number | null }>(req);
      const sub = db
        .prepare(
          `SELECT s.id, s.exam_id, c.teacher_id FROM submissions s
           JOIN examinations e ON e.id = s.exam_id JOIN courses c ON c.id = e.course_id
           WHERE s.id = ?`
        )
        .get(subId) as { id: number; exam_id: number; teacher_id: number } | undefined;

      if (!sub || sub.teacher_id !== user.id) {
        sendError(res, 404, "Submission not found.");
        return true;
      }

      if (!body.studentId) {
        db.prepare(
          "UPDATE submissions SET student_id = NULL, detected_student_name = '', detected_student_id = '', updated_at = datetime('now') WHERE id = ?"
        ).run(subId);
      } else {
        const stu = db
          .prepare("SELECT id, name, student_id_number FROM users WHERE id = ? AND role = 'student'")
          .get(Number(body.studentId)) as { id: number; name: string; student_id_number: string } | undefined;
        if (!stu) {
          sendError(res, 404, "Selected student not found.");
          return true;
        }

        // Prevent assigning two sheets in the same exam to the same student
        const conflict = db
          .prepare("SELECT id FROM submissions WHERE exam_id = ? AND student_id = ? AND id != ?")
          .get(sub.exam_id, stu.id, subId);
        if (conflict) {
          sendError(res, 409, `${stu.name} (${stu.student_id_number}) already has an uploaded answer sheet for this examination.`);
          return true;
        }

        db.prepare(
          `UPDATE submissions
           SET student_id = ?, detected_student_name = ?, detected_student_id = ?, updated_at = datetime('now')
           WHERE id = ?`
        ).run(stu.id, stu.name, stu.student_id_number, subId);
      }

      const updated = db
        .prepare(
          `SELECT s.*, u.name as student_name, u.student_id_number, d.original_name as file_name, d.page_count
           FROM submissions s LEFT JOIN users u ON u.id = s.student_id LEFT JOIN uploaded_documents d ON d.id = s.document_id
           WHERE s.id = ?`
        )
        .get(subId);
      sendJson(res, 200, { submission: updated });
      return true;
    }

    const subDeleteMatch = pathname.match(/^\/api\/submissions\/(\d+)$/);
    if (method === "DELETE" && subDeleteMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can remove uploaded scripts.");
        return true;
      }
      const subId = Number(subDeleteMatch[1]);
      const sub = db
        .prepare(
          `SELECT s.id, s.exam_id, e.status, c.teacher_id FROM submissions s
           JOIN examinations e ON e.id = s.exam_id JOIN courses c ON c.id = e.course_id
           WHERE s.id = ?`
        )
        .get(subId) as { id: number; exam_id: number; status: ExamStatus; teacher_id: number } | undefined;

      if (!sub || sub.teacher_id !== user.id) {
        sendError(res, 404, "Submission not found.");
        return true;
      }
      if (sub.status === "Published") {
        sendError(res, 400, "Cannot delete scripts from a published examination.");
        return true;
      }

      db.prepare("DELETE FROM submissions WHERE id = ?").run(subId);
      recalculateExamStatus(db, sub.exam_id);
      sendJson(res, 200, { ok: true });
      return true;
    }

    // -----------------------------------------------------------------------
    // 10. OCR Extraction & Evaluation Pipeline
    // -----------------------------------------------------------------------
    const evaluateExamMatch = pathname.match(/^\/api\/exams\/(\d+)\/evaluate$/);
    if (method === "POST" && evaluateExamMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can run evaluation.");
        return true;
      }
      const examId = Number(evaluateExamMatch[1]);
      const exam = db
        .prepare(
          `SELECT e.*, c.teacher_id FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`
        )
        .get(examId) as { id: number; teacher_id: number; answer_key_verified: number; status: ExamStatus } | undefined;

      if (!exam || exam.teacher_id !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }
      if (!exam.answer_key_verified) {
        sendError(res, 400, "Please verify the official answer key and rubric before running evaluation.");
        return true;
      }

      const submissions = db
        .prepare(
          `SELECT s.*, d.stored_name, d.mime_type, d.original_name
           FROM submissions s
           LEFT JOIN uploaded_documents d ON d.id = s.document_id
           WHERE s.exam_id = ? AND s.upload_status = 'Uploaded'`
        )
        .all(examId) as Record<string, unknown>[];

      if (submissions.length === 0) {
        sendError(res, 400, "Upload at least one student answer sheet first.");
        return true;
      }

      const unmapped = submissions.filter((s) => !s.student_id);
      if (unmapped.length > 0) {
        sendError(
          res,
          400,
          `${unmapped.length} uploaded sheet(s) do not have a confirmed student assigned. Please map every sheet before evaluation.`
        );
        return true;
      }

      const questions = db
        .prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY question_number ASC")
        .all(examId) as Record<string, unknown>[];

      db.prepare("UPDATE examinations SET status = 'Processing', updated_at = datetime('now') WHERE id = ?").run(
        examId
      );

      const processedResults: unknown[] = [];

      for (const sub of submissions) {
        const subId = Number(sub.id);
        // Skip overwriting already Teacher Approved submissions unless explicitly requested
        if (sub.review_status === "Teacher Approved") {
          processedResults.push({
            submissionId: subId,
            studentName: sub.detected_student_name,
            status: "Preserved (Already Approved)",
          });
          continue;
        }

        const filePath = sub.stored_name ? path.join(getUploadDir(), String(sub.stored_name)) : "";
        const extraction = await ocrProvider.extractDocument(filePath, String(sub.mime_type || ""));

        let totalSuggested = 0;
        let hasFlagged = false;

        for (const q of questions) {
          const qId = Number(q.id);
          const qNum = Number(q.question_number);
          const rubrics = db
            .prepare("SELECT * FROM marking_rubrics WHERE question_id = ? ORDER BY sort_order ASC")
            .all(qId) as { criterion_name: string; max_marks: number; sort_order: number }[];

          const chunk = extraction.chunks.find((c) => c.questionNumber === qNum);
          const studentAnswer = chunk ? chunk.text : "";
          const extractionUncertain = extraction.uncertain || !chunk || chunk.uncertain;

          const suggestion = await evaluateQuestionResponse({
            questionText: String(q.question_text),
            questionType: String(q.question_type) as QuestionType,
            maxMarks: Number(q.max_marks),
            referenceAnswer: String(q.reference_answer || ""),
            alternativeAnswers: safeJsonParse<string[]>(String(q.alternative_answers_json), []),
            numericalTolerance: Number(q.numerical_tolerance || 0),
            rubrics,
            studentAnswer,
            extractionUncertain,
          });

          totalSuggested += suggestion.suggestedMarks;
          const needsManual =
            suggestion.reviewStatus !== "Ready for Review" &&
            suggestion.reviewStatus !== "Teacher Approved";
          if (needsManual) hasFlagged = true;

          db.prepare(
            `INSERT INTO question_evaluations (
               submission_id, question_id, extracted_answer, page_reference, extraction_status,
               suggested_marks, approved_marks, rubric_scores_json, correct_concepts_json,
               missing_concepts_json, misconceptions_json, ai_feedback, teacher_feedback,
               evaluation_method, review_status, flagged, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, '', ?, ?, ?, datetime('now'))
             ON CONFLICT(submission_id, question_id) DO UPDATE SET
               extracted_answer = excluded.extracted_answer,
               page_reference = excluded.page_reference,
               extraction_status = excluded.extraction_status,
               suggested_marks = excluded.suggested_marks,
               rubric_scores_json = excluded.rubric_scores_json,
               correct_concepts_json = excluded.correct_concepts_json,
               missing_concepts_json = excluded.missing_concepts_json,
               misconceptions_json = excluded.misconceptions_json,
               ai_feedback = excluded.ai_feedback,
               evaluation_method = excluded.evaluation_method,
               review_status = excluded.review_status,
               flagged = excluded.flagged,
               updated_at = datetime('now')`
          ).run(
            subId,
            qId,
            studentAnswer,
            chunk?.pageNumber || Number(q.page_number) || 1,
            extractionUncertain ? (studentAnswer ? "Uncertain" : "Missing") : "Extracted",
            suggestion.suggestedMarks,
            JSON.stringify(suggestion.rubricScores),
            JSON.stringify(suggestion.correctConcepts),
            JSON.stringify(suggestion.missingConcepts),
            JSON.stringify(suggestion.misconceptions),
            suggestion.feedback,
            suggestion.evaluationMethod,
            suggestion.reviewStatus,
            needsManual ? 1 : 0
          );
        }

        db.prepare(
          `UPDATE submissions
           SET processing_status = ?,
               review_status = ?,
               total_suggested_marks = ?,
               updated_at = datetime('now')
           WHERE id = ?`
        ).run(
          hasFlagged ? "Flagged" : "Completed",
          hasFlagged ? "Needs Manual Review" : "Ready for Review",
          totalSuggested,
          subId
        );

        processedResults.push({
          submissionId: subId,
          studentName: sub.detected_student_name,
          studentIdNumber: sub.detected_student_id,
          totalSuggested,
          processingStatus: hasFlagged ? "Flagged" : "Completed",
          extractionMessage: extraction.message,
        });
      }

      const finalStatus = recalculateExamStatus(db, examId);

      createNotification(db, {
        userId: user.id,
        title: "Batch evaluation finished",
        message: `Processed ${submissions.length} script(s). ${
          processedResults.some((r: any) => r.processingStatus === "Flagged")
            ? "Some questions require manual teacher review."
            : "Ready for teacher verification."
        }`,
        type: "info",
        linkScreen: "results",
        linkEntityId: examId,
      });

      logAudit(db, {
        entityType: "exam",
        entityId: examId,
        action: "Batch evaluation completed",
        actorId: user.id,
        actorName: user.name,
        details: { submissionCount: submissions.length, status: finalStatus },
      });

      sendJson(res, 200, {
        status: finalStatus,
        ocr: getOcrCapabilities(),
        ai: getAiCapabilities(),
        processed: processedResults,
      });
      return true;
    }

    // -----------------------------------------------------------------------
    // 11. Submission Detail & Grading Workspace
    // -----------------------------------------------------------------------
    const subDetailMatch = pathname.match(/^\/api\/submissions\/(\d+)$/);
    if (method === "GET" && subDetailMatch) {
      const subId = Number(subDetailMatch[1]);
      const submission = db
        .prepare(
          `SELECT s.*, u.name as student_name, u.student_id_number, u.avatar_initials,
                  e.title as exam_title, e.exam_date, e.total_marks as exam_total_marks,
                  e.status as exam_status, e.published_at, e.course_id,
                  c.code as course_code, c.title as course_title, c.semester, c.teacher_id,
                  t.name as teacher_name,
                  d.original_name as file_name, d.mime_type, d.page_count
           FROM submissions s
           JOIN examinations e ON e.id = s.exam_id
           JOIN courses c ON c.id = e.course_id
           JOIN users t ON t.id = c.teacher_id
           LEFT JOIN users u ON u.id = s.student_id
           LEFT JOIN uploaded_documents d ON d.id = s.document_id
           WHERE s.id = ?`
        )
        .get(subId) as Record<string, unknown> | undefined;

      if (!submission) {
        sendError(res, 404, "Submission not found.");
        return true;
      }

      if (user.role === "teacher" && Number(submission.teacher_id) !== user.id) {
        sendError(res, 403, "Forbidden.");
        return true;
      }
      if (user.role === "student") {
        if (Number(submission.student_id) !== user.id) {
          sendError(res, 403, "Access denied. You may only inspect your own examination script.");
          return true;
        }
        if (submission.exam_status !== "Published") {
          sendError(res, 403, "Results for this examination have not been published yet.");
          return true;
        }
      }

      const rawQEs = db
        .prepare(
          `SELECT q.id as question_id, q.question_number, q.question_text, q.question_type,
                  q.max_marks, q.reference_answer, q.alternative_answers_json, q.topic, q.page_number,
                  qe.id as evaluation_id, qe.extracted_answer, qe.page_reference, qe.extraction_status,
                  qe.suggested_marks, qe.approved_marks, qe.rubric_scores_json,
                  qe.correct_concepts_json, qe.missing_concepts_json, qe.misconceptions_json,
                  qe.ai_feedback, qe.teacher_feedback, qe.evaluation_method, qe.review_status, qe.flagged, qe.updated_at
           FROM questions q
           LEFT JOIN question_evaluations qe ON qe.question_id = q.id AND qe.submission_id = ?
           WHERE q.exam_id = ?
           ORDER BY q.question_number ASC`
        )
        .all(subId, Number(submission.exam_id)) as Record<string, unknown>[];

      const evaluations = rawQEs.map((row) => {
        const rubrics = db
          .prepare("SELECT * FROM marking_rubrics WHERE question_id = ? ORDER BY sort_order ASC")
          .all(Number(row.question_id)) as { criterion_name: string; max_marks: number }[];
        const storedRubricScores = safeJsonParse<
          { criterionName: string; maxMarks: number; awardedMarks: number }[]
        >(String(row.rubric_scores_json), []);
        const rubricScores =
          storedRubricScores.length > 0
            ? storedRubricScores
            : rubrics.map((r) => ({
                criterionName: r.criterion_name,
                maxMarks: r.max_marks,
                awardedMarks: 0,
              }));

        // Never expose unapproved AI suggestions to students
        const isStudent = user.role === "student";
        return {
          question_id: Number(row.question_id),
          evaluation_id: row.evaluation_id ? Number(row.evaluation_id) : null,
          question_number: Number(row.question_number),
          question_text: String(row.question_text),
          question_type: String(row.question_type),
          max_marks: Number(row.max_marks),
          reference_answer: String(row.reference_answer || ""),
          topic: String(row.topic || "General"),
          extracted_answer: String(row.extracted_answer || ""),
          page_reference: Number(row.page_reference || row.page_number || 1),
          extraction_status: String(row.extraction_status || "Manual"),
          suggested_marks: isStudent ? undefined : Number(row.suggested_marks ?? 0),
          approved_marks:
            row.approved_marks !== null && row.approved_marks !== undefined
              ? Number(row.approved_marks)
              : null,
          rubric_scores: rubricScores,
          correct_concepts: safeJsonParse<string[]>(String(row.correct_concepts_json), []),
          missing_concepts: safeJsonParse<string[]>(String(row.missing_concepts_json), []),
          misconceptions: safeJsonParse<string[]>(String(row.misconceptions_json), []),
          ai_feedback: isStudent ? undefined : String(row.ai_feedback || ""),
          teacher_feedback: String(row.teacher_feedback || row.ai_feedback || ""),
          evaluation_method: isStudent ? undefined : String(row.evaluation_method || "Manual"),
          review_status: String(row.review_status || "Manual Review Required"),
          flagged: Boolean(row.flagged),
          updated_at: row.updated_at,
        };
      });

      const auditTrail =
        user.role === "teacher"
          ? db
              .prepare(
                "SELECT * FROM audit_history WHERE entity_type = 'submission' AND entity_id = ? ORDER BY created_at DESC LIMIT 20"
              )
              .all(subId)
          : [];

      sendJson(res, 200, { submission, evaluations, auditTrail });
      return true;
    }

    const gradeQuestionMatch = pathname.match(/^\/api\/submissions\/(\d+)\/questions\/(\d+)$/);
    if (method === "PUT" && gradeQuestionMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can edit marks.");
        return true;
      }
      const subId = Number(gradeQuestionMatch[1]);
      const questionId = Number(gradeQuestionMatch[2]);

      const sub = db
        .prepare(
          `SELECT s.*, e.status as exam_status, e.id as exam_id, c.teacher_id
           FROM submissions s
           JOIN examinations e ON e.id = s.exam_id
           JOIN courses c ON c.id = e.course_id
           WHERE s.id = ?`
        )
        .get(subId) as
        | { id: number; exam_id: number; exam_status: ExamStatus; teacher_id: number; student_id: number }
        | undefined;

      if (!sub || sub.teacher_id !== user.id) {
        sendError(res, 404, "Submission not found.");
        return true;
      }

      const question = db
        .prepare("SELECT * FROM questions WHERE id = ? AND exam_id = ?")
        .get(questionId, sub.exam_id) as { id: number; max_marks: number; question_number: number } | undefined;
      if (!question) {
        sendError(res, 404, "Question not found in this examination.");
        return true;
      }

      const body = await readJsonBody<{
        extractedAnswer?: string;
        approvedMarks?: number;
        rubricScores?: { criterionName: string; maxMarks: number; awardedMarks: number }[];
        teacherFeedback?: string;
        correctConcepts?: string[];
        missingConcepts?: string[];
        flagged?: boolean;
        markReviewed?: boolean;
        correctionReason?: string;
      }>(req);

      if (sub.exam_status === "Published" && !body.correctionReason?.trim()) {
        sendError(
          res,
          400,
          "This examination is already published. Modifying marks requires an audited correction reason."
        );
        return true;
      }

      const approvedMarks = Number(body.approvedMarks ?? 0);
      if (!Number.isFinite(approvedMarks) || approvedMarks < 0 || approvedMarks > question.max_marks) {
        sendError(
          res,
          400,
          `Score must be between 0 and ${question.max_marks} for Question ${question.question_number}.`
        );
        return true;
      }

      const existingQE = db
        .prepare("SELECT * FROM question_evaluations WHERE submission_id = ? AND question_id = ?")
        .get(subId, questionId) as Record<string, unknown> | undefined;

      const prevMarks = existingQE?.approved_marks ?? existingQE?.suggested_marks ?? null;
      const nextReviewStatus = body.flagged
        ? "Manual Review Required"
        : body.markReviewed !== false
          ? "Teacher Approved"
          : String(existingQE?.review_status || "Ready for Review");

      db.prepare(
        `INSERT INTO question_evaluations (
           submission_id, question_id, extracted_answer, approved_marks, rubric_scores_json,
           correct_concepts_json, missing_concepts_json, teacher_feedback, review_status, flagged, updated_by, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(submission_id, question_id) DO UPDATE SET
           extracted_answer = COALESCE(?, extracted_answer),
           approved_marks = ?,
           rubric_scores_json = COALESCE(?, rubric_scores_json),
           correct_concepts_json = COALESCE(?, correct_concepts_json),
           missing_concepts_json = COALESCE(?, missing_concepts_json),
           teacher_feedback = COALESCE(?, teacher_feedback),
           review_status = ?,
           flagged = ?,
           updated_by = ?,
           updated_at = datetime('now')`
      ).run(
        subId,
        questionId,
        body.extractedAnswer ?? "",
        approvedMarks,
        JSON.stringify(body.rubricScores || []),
        JSON.stringify(body.correctConcepts || []),
        JSON.stringify(body.missingConcepts || []),
        body.teacherFeedback ?? "",
        nextReviewStatus,
        body.flagged ? 1 : 0,
        user.id,
        // ON CONFLICT UPDATE params
        body.extractedAnswer !== undefined ? body.extractedAnswer : null,
        approvedMarks,
        body.rubricScores ? JSON.stringify(body.rubricScores) : null,
        body.correctConcepts ? JSON.stringify(body.correctConcepts) : null,
        body.missingConcepts ? JSON.stringify(body.missingConcepts) : null,
        body.teacherFeedback !== undefined ? body.teacherFeedback : null,
        nextReviewStatus,
        body.flagged ? 1 : 0,
        user.id
      );

      // Recompute submission total using approved_marks where present, otherwise suggested_marks
      const allQEs = db
        .prepare(
          `SELECT qe.approved_marks, qe.suggested_marks, qe.review_status
           FROM questions q
           LEFT JOIN question_evaluations qe ON qe.question_id = q.id AND qe.submission_id = ?
           WHERE q.exam_id = ?`
        )
        .all(subId, sub.exam_id) as {
        approved_marks: number | null;
        suggested_marks: number | null;
        review_status: string | null;
      }[];

      const totalApproved = allQEs.reduce(
        (sum, r) => sum + Number(r.approved_marks ?? r.suggested_marks ?? 0),
        0
      );
      const allApproved =
        allQEs.length > 0 && allQEs.every((r) => r.review_status === "Teacher Approved");

      db.prepare(
        `UPDATE submissions
         SET total_approved_marks = ?,
             review_status = ?,
             approved_by = CASE WHEN ? THEN ? ELSE approved_by END,
             approved_at = CASE WHEN ? THEN datetime('now') ELSE approved_at END,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        totalApproved,
        allApproved ? "Teacher Approved" : "Needs Manual Review",
        allApproved ? 1 : 0,
        user.id,
        allApproved ? 1 : 0,
        subId
      );

      recalculateExamStatus(db, sub.exam_id);

      logAudit(db, {
        entityType: "submission",
        entityId: subId,
        action:
          sub.exam_status === "Published"
            ? "Post-publication mark correction"
            : "Marks manually updated",
        actorId: user.id,
        actorName: user.name,
        details: {
          questionNumber: question.question_number,
          previousMarks: prevMarks,
          newMarks: approvedMarks,
          reason: body.correctionReason || undefined,
        },
      });

      if (sub.exam_status === "Published" && sub.student_id) {
        createNotification(db, {
          userId: sub.student_id,
          title: "Published grade updated",
          message: `Dr. ${user.name} updated Question ${question.question_number} score (${approvedMarks}/${question.max_marks}).`,
          type: "info",
          linkScreen: "studentResult",
          linkEntityId: sub.exam_id,
        });
      }

      sendJson(res, 200, {
        totalApproved,
        submissionReviewStatus: allApproved ? "Teacher Approved" : "Needs Manual Review",
      });
      return true;
    }

    const approveSubMatch = pathname.match(/^\/api\/submissions\/(\d+)\/approve$/);
    if (method === "POST" && approveSubMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can approve evaluations.");
        return true;
      }
      const subId = Number(approveSubMatch[1]);
      const body = await readJsonBody<{ teacherOverallFeedback?: string }>(req);

      const sub = db
        .prepare(
          `SELECT s.*, c.teacher_id FROM submissions s
           JOIN examinations e ON e.id = s.exam_id JOIN courses c ON c.id = e.course_id
           WHERE s.id = ?`
        )
        .get(subId) as { id: number; exam_id: number; teacher_id: number } | undefined;

      if (!sub || sub.teacher_id !== user.id) {
        sendError(res, 404, "Submission not found.");
        return true;
      }

      const questions = db
        .prepare("SELECT id FROM questions WHERE exam_id = ?")
        .all(sub.exam_id) as { id: number }[];

      for (const q of questions) {
        db.prepare(
          `INSERT INTO question_evaluations (submission_id, question_id, approved_marks, review_status, flagged, updated_by, updated_at)
           VALUES (?, ?, 0, 'Teacher Approved', 0, ?, datetime('now'))
           ON CONFLICT(submission_id, question_id) DO UPDATE SET
             approved_marks = COALESCE(approved_marks, suggested_marks, 0),
             teacher_feedback = CASE WHEN teacher_feedback = '' THEN ai_feedback ELSE teacher_feedback END,
             review_status = 'Teacher Approved',
             flagged = 0,
             updated_by = ?,
             updated_at = datetime('now')`
        ).run(subId, q.id, user.id, user.id);
      }

      const totalApproved = (
        db
          .prepare(
            "SELECT COALESCE(SUM(COALESCE(approved_marks, suggested_marks, 0)), 0) as total FROM question_evaluations WHERE submission_id = ?"
          )
          .get(subId) as { total: number }
      ).total;

      db.prepare(
        `UPDATE submissions
         SET total_approved_marks = ?,
             review_status = 'Teacher Approved',
             processing_status = 'Completed',
             teacher_overall_feedback = COALESCE(?, teacher_overall_feedback),
             approved_by = ?,
             approved_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        totalApproved,
        body.teacherOverallFeedback !== undefined ? body.teacherOverallFeedback : null,
        user.id,
        subId
      );

      const examStatus = recalculateExamStatus(db, sub.exam_id);

      logAudit(db, {
        entityType: "submission",
        entityId: subId,
        action: "Student evaluation approved",
        actorId: user.id,
        actorName: user.name,
        details: { totalApproved },
      });

      sendJson(res, 200, { totalApproved, examStatus });
      return true;
    }

    // -----------------------------------------------------------------------
    // 12. Publish Examination Results
    // -----------------------------------------------------------------------
    const publishExamMatch = pathname.match(/^\/api\/exams\/(\d+)\/publish$/);
    if (method === "POST" && publishExamMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can publish results.");
        return true;
      }
      const examId = Number(publishExamMatch[1]);
      const exam = db
        .prepare(
          `SELECT e.*, c.teacher_id FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`
        )
        .get(examId) as { id: number; title: string; total_marks: number; teacher_id: number; answer_key_verified: number } | undefined;

      if (!exam || exam.teacher_id !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }
      if (!exam.answer_key_verified) {
        sendError(res, 400, "Answer key must be verified before publishing results.");
        return true;
      }

      const subs = db
        .prepare("SELECT * FROM submissions WHERE exam_id = ? AND upload_status = 'Uploaded'")
        .all(examId) as Record<string, unknown>[];
      if (subs.length === 0) {
        sendError(res, 400, "No evaluated student scripts to publish.");
        return true;
      }
      const unapproved = subs.filter((s) => s.review_status !== "Teacher Approved");
      if (unapproved.length > 0) {
        sendError(
          res,
          400,
          `${unapproved.length} student evaluation(s) still require teacher approval before results can be published.`
        );
        return true;
      }

      db.prepare(
        `UPDATE examinations
         SET status = 'Published',
             published_at = COALESCE(published_at, datetime('now')),
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(examId);

      for (const s of subs) {
        if (s.student_id) {
          createNotification(db, {
            userId: Number(s.student_id),
            title: `Results published: ${exam.title}`,
            message: `Your result (${s.total_approved_marks}/${exam.total_marks}) and question-by-question feedback are now available.`,
            type: "success",
            linkScreen: "studentResult",
            linkEntityId: examId,
          });
        }
      }

      logAudit(db, {
        entityType: "exam",
        entityId: examId,
        action: "Results published",
        actorId: user.id,
        actorName: user.name,
        details: { title: exam.title, studentCount: subs.length },
      });

      const updated = db.prepare("SELECT * FROM examinations WHERE id = ?").get(examId);
      sendJson(res, 200, { exam: updated });
      return true;
    }

    // -----------------------------------------------------------------------
    // 13. Private Document Access (Role & Ownership Protected)
    // -----------------------------------------------------------------------
    const fileMatch = pathname.match(/^\/api\/files\/(\d+)$/);
    if (method === "GET" && fileMatch) {
      const docId = Number(fileMatch[1]);
      const doc = db
        .prepare("SELECT * FROM uploaded_documents WHERE id = ?")
        .get(docId) as
        | {
            id: number;
            original_name: string;
            stored_name: string;
            mime_type: string;
            doc_kind: string;
            uploaded_by: number;
          }
        | undefined;

      if (!doc) {
        sendError(res, 404, "Document not found.");
        return true;
      }

      let authorized = false;
      if (user.role === "teacher") {
        // Teacher who uploaded or owns the exam
        if (doc.uploaded_by === user.id) authorized = true;
      } else if (user.role === "student") {
        // Student can ONLY view their own submission document for a Published exam
        const ownsPublished = db
          .prepare(
            `SELECT 1 FROM submissions s
             JOIN examinations e ON e.id = s.exam_id
             WHERE s.document_id = ? AND s.student_id = ? AND e.status = 'Published'`
          )
          .get(docId, user.id);
        if (ownsPublished) authorized = true;
      }

      if (!authorized) {
        sendError(res, 403, "You are not authorized to access this private academic document.");
        return true;
      }

      const fullPath = path.join(getUploadDir(), doc.stored_name);
      if (!fs.existsSync(fullPath)) {
        sendError(res, 404, "Stored document file missing.");
        return true;
      }

      const buf = fs.readFileSync(fullPath);
      res.statusCode = 200;
      res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
      res.setHeader("Content-Disposition", `inline; filename="${doc.original_name.replace(/"/g, "")}"`);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.end(buf);
      return true;
    }

    // -----------------------------------------------------------------------
    // 14. Recheck Request Workflow
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/rechecks") {
      if (user.role === "teacher") {
        const items = db
          .prepare(
            `SELECT rr.*, u.name as student_name, u.student_id_number,
                    e.title as exam_title, e.total_marks as exam_total_marks,
                    c.code as course_code, c.title as course_title,
                    q.question_number, q.question_text, q.max_marks as question_max_marks, q.reference_answer,
                    qe.extracted_answer, qe.approved_marks as current_question_marks, qe.teacher_feedback
             FROM recheck_requests rr
             JOIN users u ON u.id = rr.student_id
             JOIN examinations e ON e.id = rr.exam_id
             JOIN courses c ON c.id = e.course_id
             JOIN questions q ON q.id = rr.question_id
             LEFT JOIN question_evaluations qe ON qe.submission_id = rr.submission_id AND qe.question_id = rr.question_id
             WHERE c.teacher_id = ?
             ORDER BY CASE rr.status WHEN 'Submitted' THEN 0 WHEN 'Under Review' THEN 1 ELSE 2 END, rr.created_at DESC`
          )
          .all(user.id);
        sendJson(res, 200, { rechecks: items });
      } else {
        const items = db
          .prepare(
            `SELECT rr.*, e.title as exam_title, c.code as course_code, c.title as course_title,
                    q.question_number, q.question_text, q.max_marks as question_max_marks
             FROM recheck_requests rr
             JOIN examinations e ON e.id = rr.exam_id
             JOIN courses c ON c.id = e.course_id
             JOIN questions q ON q.id = rr.question_id
             WHERE rr.student_id = ?
             ORDER BY rr.created_at DESC`
          )
          .all(user.id);
        sendJson(res, 200, { rechecks: items });
      }
      return true;
    }

    if (method === "POST" && pathname === "/api/rechecks") {
      if (user.role !== "student") {
        sendError(res, 403, "Only students can submit recheck requests.");
        return true;
      }
      const body = await readJsonBody<{
        examId?: number;
        questionId?: number;
        reason?: string;
        comment?: string;
      }>(req);

      const examId = Number(body.examId);
      const questionId = Number(body.questionId);
      const reason = (body.reason || "").trim();
      const comment = (body.comment || "").trim().slice(0, 500);

      if (!examId || !questionId || !reason) {
        sendError(res, 400, "Examination, question, and reason are required.");
        return true;
      }

      const sub = db
        .prepare(
          `SELECT s.id, e.status as exam_status, e.title as exam_title, c.teacher_id
           FROM submissions s
           JOIN examinations e ON e.id = s.exam_id
           JOIN courses c ON c.id = e.course_id
           WHERE s.exam_id = ? AND s.student_id = ?`
        )
        .get(examId, user.id) as
        | { id: number; exam_status: ExamStatus; exam_title: string; teacher_id: number }
        | undefined;

      if (!sub || sub.exam_status !== "Published") {
        sendError(res, 403, "Recheck requests are only allowed on your published examination results.");
        return true;
      }

      const duplicate = db
        .prepare(
          `SELECT id FROM recheck_requests
           WHERE student_id = ? AND exam_id = ? AND question_id = ? AND status IN ('Submitted', 'Under Review')`
        )
        .get(user.id, examId, questionId);

      if (duplicate) {
        sendError(res, 409, "You already have an active recheck request for this question.");
        return true;
      }

      const qe = db
        .prepare(
          `SELECT q.question_number, COALESCE(qe.approved_marks, 0) as current_marks
           FROM questions q
           LEFT JOIN question_evaluations qe ON qe.question_id = q.id AND qe.submission_id = ?
           WHERE q.id = ? AND q.exam_id = ?`
        )
        .get(sub.id, questionId, examId) as { question_number: number; current_marks: number } | undefined;

      if (!qe) {
        sendError(res, 404, "Question not found in this examination.");
        return true;
      }

      const ins = db
        .prepare(
          `INSERT INTO recheck_requests (submission_id, question_id, student_id, exam_id, reason, student_comment, status, original_marks)
           VALUES (?, ?, ?, ?, ?, ?, 'Submitted', ?)`
        )
        .run(sub.id, questionId, user.id, examId, reason, comment, qe.current_marks);

      createNotification(db, {
        userId: sub.teacher_id,
        title: "New recheck request",
        message: `${user.name} (${user.student_id_number}) requested a recheck on ${sub.exam_title} · Q${qe.question_number}.`,
        type: "info",
        linkScreen: "teacherRechecks",
        linkEntityId: Number(ins.lastInsertRowid),
      });

      logAudit(db, {
        entityType: "recheck",
        entityId: Number(ins.lastInsertRowid),
        action: "Recheck request submitted",
        actorId: user.id,
        actorName: user.name,
        details: { examId, questionId, originalMarks: qe.current_marks },
      });

      const created = db
        .prepare("SELECT * FROM recheck_requests WHERE id = ?")
        .get(Number(ins.lastInsertRowid));
      sendJson(res, 201, { recheck: created });
      return true;
    }

    const recheckUpdateMatch = pathname.match(/^\/api\/rechecks\/(\d+)$/);
    if (method === "PUT" && recheckUpdateMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can resolve recheck requests.");
        return true;
      }
      const recheckId = Number(recheckUpdateMatch[1]);
      const rr = db
        .prepare(
          `SELECT rr.*, q.max_marks, q.question_number, e.title as exam_title, c.teacher_id
           FROM recheck_requests rr
           JOIN questions q ON q.id = rr.question_id
           JOIN examinations e ON e.id = rr.exam_id
           JOIN courses c ON c.id = e.course_id
           WHERE rr.id = ?`
        )
        .get(recheckId) as
        | {
            id: number;
            submission_id: number;
            question_id: number;
            student_id: number;
            exam_id: number;
            original_marks: number;
            max_marks: number;
            question_number: number;
            exam_title: string;
            teacher_id: number;
            status: RecheckStatus;
          }
        | undefined;

      if (!rr || rr.teacher_id !== user.id) {
        sendError(res, 404, "Recheck request not found.");
        return true;
      }

      const body = await readJsonBody<{
        status?: RecheckStatus;
        adjustedMarks?: number;
        teacherResponse?: string;
      }>(req);

      const nextStatus = body.status || "Resolved";
      if (!["Submitted", "Under Review", "Resolved", "Rejected"].includes(nextStatus)) {
        sendError(res, 400, "Invalid recheck status.");
        return true;
      }

      let finalMarks = rr.original_marks;
      if (body.adjustedMarks !== undefined && body.adjustedMarks !== null) {
        const adj = Number(body.adjustedMarks);
        if (!Number.isFinite(adj) || adj < 0 || adj > rr.max_marks) {
          sendError(res, 400, `Adjusted marks must be between 0 and ${rr.max_marks}.`);
          return true;
        }
        finalMarks = adj;
      }

      if (nextStatus === "Resolved" && finalMarks !== rr.original_marks) {
        db.prepare(
          `UPDATE question_evaluations
           SET approved_marks = ?,
               teacher_feedback = CASE WHEN ? != '' THEN teacher_feedback || '\n[Recheck Note]: ' || ? ELSE teacher_feedback END,
               updated_by = ?,
               updated_at = datetime('now')
           WHERE submission_id = ? AND question_id = ?`
        ).run(
          finalMarks,
          (body.teacherResponse || "").trim(),
          (body.teacherResponse || "").trim(),
          user.id,
          rr.submission_id,
          rr.question_id
        );

        const newTotal = (
          db
            .prepare(
              "SELECT COALESCE(SUM(COALESCE(approved_marks, 0)), 0) as total FROM question_evaluations WHERE submission_id = ?"
            )
            .get(rr.submission_id) as { total: number }
        ).total;

        db.prepare(
          "UPDATE submissions SET total_approved_marks = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(newTotal, rr.submission_id);
      }

      db.prepare(
        `UPDATE recheck_requests
         SET status = ?,
             adjusted_marks = ?,
             teacher_response = ?,
             reviewed_by = ?,
             reviewed_at = CASE WHEN ? IN ('Resolved', 'Rejected') THEN datetime('now') ELSE reviewed_at END,
             updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        nextStatus,
        nextStatus === "Resolved" ? finalMarks : null,
        (body.teacherResponse || "").trim(),
        user.id,
        nextStatus,
        recheckId
      );

      if (nextStatus === "Resolved" || nextStatus === "Rejected") {
        createNotification(db, {
          userId: rr.student_id,
          title: `Recheck request ${nextStatus.toLowerCase()}`,
          message: `Your recheck request for ${rr.exam_title} · Q${rr.question_number} was ${nextStatus.toLowerCase()}${
            nextStatus === "Resolved" ? ` (Updated marks: ${finalMarks}/${rr.max_marks})` : ""
          }.`,
          type: nextStatus === "Resolved" ? "success" : "info",
          linkScreen: "recheck",
          linkEntityId: rr.exam_id,
        });
      }

      logAudit(db, {
        entityType: "recheck",
        entityId: recheckId,
        action: `Recheck ${nextStatus.toLowerCase()}`,
        actorId: user.id,
        actorName: user.name,
        details: {
          originalMarks: rr.original_marks,
          adjustedMarks: nextStatus === "Resolved" ? finalMarks : rr.original_marks,
          response: body.teacherResponse || "",
        },
      });

      const updated = db.prepare("SELECT * FROM recheck_requests WHERE id = ?").get(recheckId);
      sendJson(res, 200, { recheck: updated });
      return true;
    }

    // -----------------------------------------------------------------------
    // 15. Student Mistake Analysis
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/student/mistakes") {
      if (user.role !== "student") {
        sendError(res, 403, "Student access required.");
        return true;
      }
      const examIdParam = urlObj.searchParams.get("examId");

      const publishedSubs = db
        .prepare(
          `SELECT s.id as submission_id, e.id as exam_id, e.title as exam_title, e.total_marks,
                  c.code as course_code, c.title as course_title
           FROM submissions s
           JOIN examinations e ON e.id = s.exam_id
           JOIN courses c ON c.id = e.course_id
           WHERE s.student_id = ? AND e.status = 'Published'
           ORDER BY e.exam_date DESC`
        )
        .all(user.id) as Record<string, unknown>[];

      const selectedSub = examIdParam
        ? publishedSubs.find((s) => Number(s.exam_id) === Number(examIdParam))
        : publishedSubs[0];

      if (!selectedSub) {
        sendJson(res, 200, {
          exams: publishedSubs,
          selectedExam: null,
          summary: { totalQuestions: 0, fullMarksQuestions: 0, questionsToImprove: 0 },
          topics: [],
          questions: [],
        });
        return true;
      }

      const qRows = db
        .prepare(
          `SELECT q.id as question_id, q.question_number, q.question_text, q.max_marks, q.topic,
                  qe.approved_marks, qe.missing_concepts_json, qe.correct_concepts_json, qe.teacher_feedback
           FROM questions q
           JOIN question_evaluations qe ON qe.question_id = q.id AND qe.submission_id = ?
           WHERE q.exam_id = ?
           ORDER BY q.question_number ASC`
        )
        .all(Number(selectedSub.submission_id), Number(selectedSub.exam_id)) as Record<string, unknown>[];

      let fullMarksQuestions = 0;
      const topicsMap = new Map<
        string,
        {
          topic: string;
          missedConcepts: string[];
          suggestions: string[];
          questionNumbers: number[];
          marksLost: number;
        }
      >();

      const questionMistakes = qRows.map((q) => {
        const awarded = Number(q.approved_marks ?? 0);
        const max = Number(q.max_marks);
        const isFull = Math.abs(awarded - max) < 0.01;
        if (isFull) fullMarksQuestions++;

        const missing = safeJsonParse<string[]>(String(q.missing_concepts_json), []);
        const topic = String(q.topic || "General");

        if (!isFull) {
          const entry = topicsMap.get(topic) || {
            topic,
            missedConcepts: [],
            suggestions: [],
            questionNumbers: [],
            marksLost: 0,
          };
          entry.questionNumbers.push(Number(q.question_number));
          entry.marksLost += Number((max - awarded).toFixed(2));
          for (const m of missing) {
            if (!entry.missedConcepts.includes(m)) entry.missedConcepts.push(m);
          }
          const fb = String(q.teacher_feedback || "").trim();
          if (fb && !entry.suggestions.includes(fb)) entry.suggestions.push(fb);
          topicsMap.set(topic, entry);
        }

        return {
          questionId: Number(q.question_id),
          questionNumber: Number(q.question_number),
          questionText: String(q.question_text),
          topic,
          awardedMarks: awarded,
          maxMarks: max,
          missingConcepts: missing,
          teacherFeedback: String(q.teacher_feedback || ""),
        };
      });

      sendJson(res, 200, {
        exams: publishedSubs,
        selectedExam: selectedSub,
        summary: {
          totalQuestions: qRows.length,
          fullMarksQuestions,
          questionsToImprove: qRows.length - fullMarksQuestions,
        },
        topics: Array.from(topicsMap.values()),
        questions: questionMistakes,
      });
      return true;
    }

    // -----------------------------------------------------------------------
    // 16. Teacher Analytics & Reports
    // -----------------------------------------------------------------------
    if (method === "GET" && pathname === "/api/teacher/analytics") {
      if (user.role !== "teacher") {
        sendError(res, 403, "Teacher access required.");
        return true;
      }

      const examIdParam = Number(urlObj.searchParams.get("examId"));
      const exams = db
        .prepare(
          `SELECT e.id, e.title, e.total_marks, e.pass_threshold, e.status, c.code as course_code
           FROM examinations e JOIN courses c ON c.id = e.course_id
           WHERE c.teacher_id = ?
           ORDER BY e.exam_date DESC`
        )
        .all(user.id) as Record<string, unknown>[];

      const targetExam =
        exams.find((e) => Number(e.id) === examIdParam) ||
        exams.find((e) => e.status === "Published") ||
        exams[0];

      if (!targetExam) {
        sendJson(res, 200, { exams: [], analytics: null });
        return true;
      }

      const targetExamId = Number(targetExam.id);
      const totalMarks = Number(targetExam.total_marks);
      const passPct = Number(
        urlObj.searchParams.get("passThreshold") ?? targetExam.pass_threshold ?? 40
      );

      const approvedSubs = db
        .prepare(
          `SELECT s.id, s.total_approved_marks, u.name as student_name, u.student_id_number
           FROM submissions s LEFT JOIN users u ON u.id = s.student_id
           WHERE s.exam_id = ? AND s.review_status = 'Teacher Approved' AND s.total_approved_marks IS NOT NULL`
        )
        .all(targetExamId) as {
        id: number;
        total_approved_marks: number;
        student_name: string;
        student_id_number: string;
      }[];

      const scores = approvedSubs.map((s) => Number(s.total_approved_marks));
      const count = scores.length;
      const averageScore = count ? Number((scores.reduce((a, b) => a + b, 0) / count).toFixed(2)) : 0;
      const highestScore = count ? Math.max(...scores) : 0;
      const lowestScore = count ? Math.min(...scores) : 0;
      const passCount = scores.filter((sc) => (totalMarks > 0 ? (sc / totalMarks) * 100 >= passPct : false)).length;
      const passRate = count ? Number(((passCount / count) * 100).toFixed(1)) : 0;

      // Distribution buckets (0-39%, 40-59%, 60-74%, 75-89%, 90-100%)
      const buckets = [
        { label: "0–39%", count: 0 },
        { label: "40–59%", count: 0 },
        { label: "60–74%", count: 0 },
        { label: "75–89%", count: 0 },
        { label: "90–100%", count: 0 },
      ];
      for (const sc of scores) {
        const pct = totalMarks > 0 ? (sc / totalMarks) * 100 : 0;
        if (pct < 40) buckets[0].count++;
        else if (pct < 60) buckets[1].count++;
        else if (pct < 75) buckets[2].count++;
        else if (pct < 90) buckets[3].count++;
        else buckets[4].count++;
      }

      // Question-wise averages & commonly missed criteria
      const questions = db
        .prepare("SELECT id, question_number, question_text, max_marks, topic FROM questions WHERE exam_id = ? ORDER BY question_number ASC")
        .all(targetExamId) as { id: number; question_number: number; question_text: string; max_marks: number; topic: string }[];

      const questionAverages = questions.map((q) => {
        const qEvals = db
          .prepare(
            `SELECT qe.approved_marks, qe.missing_concepts_json
             FROM question_evaluations qe
             JOIN submissions s ON s.id = qe.submission_id
             WHERE qe.question_id = ? AND s.review_status = 'Teacher Approved' AND qe.approved_marks IS NOT NULL`
          )
          .all(q.id) as { approved_marks: number; missing_concepts_json: string }[];

        const avg = qEvals.length
          ? Number((qEvals.reduce((sum, x) => sum + Number(x.approved_marks), 0) / qEvals.length).toFixed(2))
          : 0;
        const pct = q.max_marks > 0 ? Number(((avg / q.max_marks) * 100).toFixed(1)) : 0;

        const missCounts = new Map<string, number>();
        for (const ev of qEvals) {
          for (const m of safeJsonParse<string[]>(ev.missing_concepts_json, [])) {
            missCounts.set(m, (missCounts.get(m) || 0) + 1);
          }
        }
        const topMissed = Array.from(missCounts.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .map(([text, hits]) => ({ text, hits }));

        return {
          questionNumber: q.question_number,
          topic: q.topic,
          maxMarks: q.max_marks,
          averageMarks: avg,
          averagePercent: pct,
          topMissed,
        };
      });

      sendJson(res, 200, {
        exams,
        analytics: {
          exam: targetExam,
          passThreshold: passPct,
          studentsEvaluated: count,
          averageScore,
          highestScore,
          lowestScore,
          passRate,
          distribution: buckets,
          questionAverages,
        },
      });
      return true;
    }

    // -----------------------------------------------------------------------
    // 17. Real CSV & PDF Exports
    // -----------------------------------------------------------------------
    const csvExportMatch = pathname.match(/^\/api\/exams\/(\d+)\/export\/csv$/);
    if (method === "GET" && csvExportMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can export examination reports.");
        return true;
      }
      const examId = Number(csvExportMatch[1]);
      const exportType = urlObj.searchParams.get("type") || "results";

      const exam = db
        .prepare(
          `SELECT e.*, c.code as course_code, c.title as course_title, c.teacher_id
           FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`
        )
        .get(examId) as Record<string, unknown> | undefined;
      if (!exam || Number(exam.teacher_id) !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }

      const questions = db
        .prepare("SELECT * FROM questions WHERE exam_id = ? ORDER BY question_number ASC")
        .all(examId) as { id: number; question_number: number; max_marks: number; topic: string }[];

      const submissions = db
        .prepare(
          `SELECT s.*, u.name as student_name, u.student_id_number
           FROM submissions s LEFT JOIN users u ON u.id = s.student_id
           WHERE s.exam_id = ? ORDER BY COALESCE(u.student_id_number, s.detected_student_id) ASC`
        )
        .all(examId) as Record<string, unknown>[];

      let csvContent = "";
      let fileName = `${String(exam.course_code).replace(/\s+/g, "_")}_${exportType}.csv`;

      if (exportType === "questions") {
        const headers = [
          "Student ID",
          "Student Name",
          ...questions.map((q) => `Q${q.question_number} (${q.max_marks})`),
          `Total (${exam.total_marks})`,
          "Review Status",
        ];
        const rows: string[] = [headers.map(csvEscape).join(",")];

        for (const s of submissions) {
          const qScores = questions.map((q) => {
            const qe = db
              .prepare(
                "SELECT approved_marks, suggested_marks FROM question_evaluations WHERE submission_id = ? AND question_id = ?"
              )
              .get(Number(s.id), q.id) as { approved_marks: number | null; suggested_marks: number | null } | undefined;
            return qe ? (qe.approved_marks ?? qe.suggested_marks ?? 0) : 0;
          });
          const total = s.total_approved_marks ?? s.total_suggested_marks ?? 0;
          rows.push(
            [
              s.student_id_number || s.detected_student_id,
              s.student_name || s.detected_student_name,
              ...qScores,
              total,
              s.review_status,
            ]
              .map(csvEscape)
              .join(",")
          );
        }
        csvContent = rows.join("\r\n");
      } else if (exportType === "summary") {
        const rows: string[] = [
          ["Metric", "Value"].map(csvEscape).join(","),
          ["Institution", "Stamford University Bangladesh"].map(csvEscape).join(","),
          ["Course", `${exam.course_code} - ${exam.course_title}`].map(csvEscape).join(","),
          ["Examination", String(exam.title)].map(csvEscape).join(","),
          ["Date", String(exam.exam_date)].map(csvEscape).join(","),
          ["Status", String(exam.status)].map(csvEscape).join(","),
          ["Total Students", String(submissions.length)].map(csvEscape).join(","),
          [
            "Teacher Approved Scripts",
            String(submissions.filter((s) => s.review_status === "Teacher Approved").length),
          ]
            .map(csvEscape)
            .join(","),
        ];
        csvContent = rows.join("\r\n");
      } else {
        const headers = [
          "Student ID",
          "Student Name",
          "Course",
          "Examination",
          "Suggested Score",
          "Teacher Approved Score",
          "Maximum Marks",
          "Percentage",
          "Review Status",
        ];
        const rows: string[] = [headers.map(csvEscape).join(",")];
        for (const s of submissions) {
          const finalScore = s.total_approved_marks ?? s.total_suggested_marks ?? 0;
          const pct = Number(exam.total_marks) > 0 ? ((Number(finalScore) / Number(exam.total_marks)) * 100).toFixed(1) : "0.0";
          rows.push(
            [
              s.student_id_number || s.detected_student_id,
              s.student_name || s.detected_student_name,
              `${exam.course_code} - ${exam.course_title}`,
              exam.title,
              s.total_suggested_marks ?? 0,
              s.total_approved_marks ?? "Pending",
              exam.total_marks,
              `${pct}%`,
              s.review_status,
            ]
              .map(csvEscape)
              .join(",")
          );
        }
        csvContent = rows.join("\r\n");
      }

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.end(csvContent);
      return true;
    }

    const pdfExamExportMatch = pathname.match(/^\/api\/exams\/(\d+)\/export\/pdf$/);
    if (method === "GET" && pdfExamExportMatch) {
      if (user.role !== "teacher") {
        sendError(res, 403, "Only teachers can export examination PDFs.");
        return true;
      }
      const examId = Number(pdfExamExportMatch[1]);
      const exam = db
        .prepare(
          `SELECT e.*, c.code as course_code, c.title as course_title, c.semester, c.teacher_id
           FROM examinations e JOIN courses c ON c.id = e.course_id WHERE e.id = ?`
        )
        .get(examId) as Record<string, unknown> | undefined;
      if (!exam || Number(exam.teacher_id) !== user.id) {
        sendError(res, 404, "Examination not found.");
        return true;
      }

      const submissions = db
        .prepare(
          `SELECT s.*, u.name as student_name, u.student_id_number
           FROM submissions s LEFT JOIN users u ON u.id = s.student_id
           WHERE s.exam_id = ? ORDER BY COALESCE(u.student_id_number, s.detected_student_id) ASC`
        )
        .all(examId) as Record<string, unknown>[];

      const lines: string[] = [
        `## Examination Result Sheet`,
        `Course: ${exam.course_code} - ${exam.course_title} (${exam.semester})`,
        `Examination: ${exam.title} | Date: ${exam.exam_date} | Total Marks: ${exam.total_marks}`,
        `Status: ${exam.status} | Prepared by: ${user.name}`,
        "",
        "## Student Marks Summary",
      ];

      for (const s of submissions) {
        const finalScore = s.total_approved_marks ?? s.total_suggested_marks ?? 0;
        const pct = Number(exam.total_marks) > 0 ? ((Number(finalScore) / Number(exam.total_marks)) * 100).toFixed(1) : "0.0";
        lines.push(
          `${s.student_id_number || s.detected_student_id}  |  ${s.student_name || s.detected_student_name}  |  Score: ${finalScore} / ${exam.total_marks} (${pct}%)  |  ${s.review_status}`
        );
      }

      const pdfBuf = generatePdfBuffer([
        {
          header: "Stamford University Bangladesh — Department of CSE",
          subheader: "EvalDesk Official Examination Result Sheet",
          lines,
        },
      ]);

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${String(exam.course_code).replace(/\s+/g, "_")}_Result_Sheet.pdf"`
      );
      res.end(pdfBuf);
      return true;
    }

    const subPdfMatch = pathname.match(/^\/api\/submissions\/(\d+)\/feedback-pdf$/);
    if (method === "GET" && subPdfMatch) {
      const subId = Number(subPdfMatch[1]);
      const sub = db
        .prepare(
          `SELECT s.*, u.name as student_name, u.student_id_number,
                  e.title as exam_title, e.exam_date, e.total_marks, e.status as exam_status,
                  c.code as course_code, c.title as course_title, c.teacher_id, t.name as teacher_name
           FROM submissions s
           JOIN examinations e ON e.id = s.exam_id
           JOIN courses c ON c.id = e.course_id
           JOIN users t ON t.id = c.teacher_id
           LEFT JOIN users u ON u.id = s.student_id
           WHERE s.id = ?`
        )
        .get(subId) as Record<string, unknown> | undefined;

      if (!sub) {
        sendError(res, 404, "Submission not found.");
        return true;
      }
      if (user.role === "teacher" && Number(sub.teacher_id) !== user.id) {
        sendError(res, 403, "Forbidden.");
        return true;
      }
      if (user.role === "student") {
        if (Number(sub.student_id) !== user.id || sub.exam_status !== "Published") {
          sendError(res, 403, "You can only download feedback for your own published examination.");
          return true;
        }
      }

      const evals = db
        .prepare(
          `SELECT q.question_number, q.question_text, q.max_marks, q.reference_answer,
                  qe.extracted_answer, qe.approved_marks, qe.teacher_feedback, qe.ai_feedback,
                  qe.correct_concepts_json, qe.missing_concepts_json
           FROM questions q
           LEFT JOIN question_evaluations qe ON qe.question_id = q.id AND qe.submission_id = ?
           WHERE q.exam_id = ?
           ORDER BY q.question_number ASC`
        )
        .all(subId, Number(sub.exam_id)) as Record<string, unknown>[];

      const totalScore = sub.total_approved_marks ?? 0;
      const pct = Number(sub.total_marks) > 0 ? ((Number(totalScore) / Number(sub.total_marks)) * 100).toFixed(1) : "0.0";

      const pages: { header?: string; subheader?: string; lines: string[] }[] = [];
      const firstPageLines: string[] = [
        `## Student Evaluation & Feedback Report`,
        `Student: ${sub.student_name} (${sub.student_id_number})`,
        `Course: ${sub.course_code} - ${sub.course_title}`,
        `Examination: ${sub.exam_title} (${sub.exam_date})`,
        `Total Approved Marks: ${totalScore} / ${sub.total_marks} (${pct}%)`,
        `Instructor: ${sub.teacher_name}`,
        sub.teacher_overall_feedback ? `Overall Feedback: ${sub.teacher_overall_feedback}` : "",
        "",
      ];

      let currentLines = firstPageLines;
      for (const ev of evals) {
        const block = [
          `## Question ${ev.question_number} (${ev.approved_marks ?? 0} / ${ev.max_marks} marks)`,
          `Prompt: ${ev.question_text}`,
          `Your Answer: ${ev.extracted_answer || "No answer recorded"}`,
          `Reference Answer: ${ev.reference_answer}`,
          `Teacher Feedback: ${ev.teacher_feedback || ev.ai_feedback || "Reviewed"}`,
          ...safeJsonParse<string[]>(String(ev.missing_concepts_json), []).map((m) => `Improvement: ${m}`),
          "",
        ];
        if (currentLines.length + block.length > 42) {
          pages.push({
            header: "Stamford University Bangladesh — Department of CSE",
            subheader: `Individual Feedback Report · ${sub.student_name} (${sub.student_id_number})`,
            lines: currentLines,
          });
          currentLines = block;
        } else {
          currentLines.push(...block);
        }
      }
      pages.push({
        header: "Stamford University Bangladesh — Department of CSE",
        subheader: `Individual Feedback Report · ${sub.student_name} (${sub.student_id_number})`,
        lines: currentLines,
      });

      const pdfBuf = generatePdfBuffer(pages);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${sub.student_id_number || "Student"}_Feedback_Report.pdf"`
      );
      res.end(pdfBuf);
      return true;
    }

    sendError(res, 404, `API endpoint not found: ${method} ${pathname}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error.";
    sendError(res, 500, message);
    return true;
  }
}

