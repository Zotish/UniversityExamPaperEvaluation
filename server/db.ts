import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

let dbInstance: DatabaseSync | null = null;
let initializedPath: string | null = null;

export function getDataDir(): string {
  const customDb = process.env.EVALDESK_DB_PATH;
  if (customDb) {
    return path.dirname(customDb);
  }
  return path.resolve(process.cwd(), "data");
}

export function getUploadDir(): string {
  const dir = path.join(getDataDir(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDb(): DatabaseSync {
  const dbPath =
    process.env.EVALDESK_DB_PATH || path.join(getDataDir(), "evaldesk.db");

  if (dbInstance && initializedPath === dbPath) {
    return dbInstance;
  }

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  getUploadDir();

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  runMigrations(db);

  dbInstance = db;
  initializedPath = dbPath;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    initializedPath = null;
  }
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
      department TEXT NOT NULL DEFAULT 'Computer Science and Engineering',
      designation TEXT,
      student_id_number TEXT UNIQUE,
      teacher_id_number TEXT UNIQUE,
      avatar_initials TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS faculty_registry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id_number TEXT NOT NULL UNIQUE,
      full_name TEXT,
      expected_email TEXT,
      department TEXT NOT NULL DEFAULT 'Computer Science and Engineering',
      designation TEXT NOT NULL DEFAULT 'Lecturer',
      claimed_by_user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      department TEXT NOT NULL,
      semester TEXT NOT NULL,
      teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS course_enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(course_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS uploaded_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL,
      page_count INTEGER NOT NULL DEFAULT 1,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      doc_kind TEXT NOT NULL CHECK (doc_kind IN ('answer_key', 'student_sheet')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS examinations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      total_marks REAL NOT NULL,
      pass_threshold REAL NOT NULL DEFAULT 40,
      total_questions INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN (
        'Draft',
        'Awaiting Answer Key',
        'Ready for Upload',
        'Processing',
        'Needs Review',
        'Ready to Publish',
        'Published',
        'Archived'
      )),
      answer_key_verified INTEGER NOT NULL DEFAULT 0,
      answer_key_file_id INTEGER REFERENCES uploaded_documents(id) ON DELETE SET NULL,
      published_at TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
      question_number INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      question_type TEXT NOT NULL CHECK (question_type IN (
        'MCQ',
        'Short Answer',
        'Descriptive',
        'True/False',
        'Numerical'
      )),
      max_marks REAL NOT NULL,
      reference_answer TEXT NOT NULL DEFAULT '',
      alternative_answers_json TEXT NOT NULL DEFAULT '[]',
      numerical_tolerance REAL NOT NULL DEFAULT 0,
      topic TEXT NOT NULL DEFAULT 'General',
      page_number INTEGER NOT NULL DEFAULT 1,
      UNIQUE(exam_id, question_number)
    );

    CREATE TABLE IF NOT EXISTS marking_rubrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      criterion_name TEXT NOT NULL,
      max_marks REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
      student_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      document_id INTEGER REFERENCES uploaded_documents(id) ON DELETE SET NULL,
      detected_student_name TEXT NOT NULL DEFAULT '',
      detected_student_id TEXT NOT NULL DEFAULT '',
      upload_status TEXT NOT NULL DEFAULT 'Uploaded' CHECK (upload_status IN ('Uploaded', 'Failed', 'Duplicate')),
      processing_status TEXT NOT NULL DEFAULT 'Pending' CHECK (processing_status IN ('Pending', 'Processing', 'Completed', 'Flagged', 'Failed')),
      review_status TEXT NOT NULL DEFAULT 'Pending' CHECK (review_status IN ('Pending', 'Ready for Review', 'Needs Manual Review', 'Teacher Approved')),
      total_suggested_marks REAL NOT NULL DEFAULT 0,
      total_approved_marks REAL,
      teacher_overall_feedback TEXT NOT NULL DEFAULT '',
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS question_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      extracted_answer TEXT NOT NULL DEFAULT '',
      page_reference INTEGER NOT NULL DEFAULT 1,
      extraction_status TEXT NOT NULL DEFAULT 'Extracted' CHECK (extraction_status IN ('Extracted', 'Uncertain', 'Missing', 'Manual')),
      suggested_marks REAL NOT NULL DEFAULT 0,
      approved_marks REAL,
      rubric_scores_json TEXT NOT NULL DEFAULT '[]',
      correct_concepts_json TEXT NOT NULL DEFAULT '[]',
      missing_concepts_json TEXT NOT NULL DEFAULT '[]',
      misconceptions_json TEXT NOT NULL DEFAULT '[]',
      ai_feedback TEXT NOT NULL DEFAULT '',
      teacher_feedback TEXT NOT NULL DEFAULT '',
      evaluation_method TEXT NOT NULL DEFAULT 'Manual',
      review_status TEXT NOT NULL DEFAULT 'Manual Review Required' CHECK (review_status IN (
        'Ready for Review',
        'Extraction Uncertain',
        'Rubric Match Uncertain',
        'Manual Review Required',
        'Teacher Approved'
      )),
      flagged INTEGER NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(submission_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS recheck_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_id INTEGER NOT NULL REFERENCES examinations(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      student_comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Under Review', 'Resolved', 'Rejected')),
      original_marks REAL NOT NULL,
      adjusted_marks REAL,
      teacher_response TEXT NOT NULL DEFAULT '',
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info',
      link_screen TEXT,
      link_entity_id INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "teacher_id_number")) {
    db.exec("ALTER TABLE users ADD COLUMN teacher_id_number TEXT;");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_teacher_id_number ON users(teacher_id_number);"
    );
  }
}

export function logAudit(
  db: DatabaseSync,
  params: {
    entityType: string;
    entityId: number;
    action: string;
    actorId: number | null;
    actorName: string;
    details?: Record<string, unknown>;
  }
): void {
  db.prepare(
    `INSERT INTO audit_history (entity_type, entity_id, action, actor_id, actor_name, details_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    params.entityType,
    params.entityId,
    params.action,
    params.actorId,
    params.actorName,
    JSON.stringify(params.details ?? {})
  );
}

export function createNotification(
  db: DatabaseSync,
  params: {
    userId: number;
    title: string;
    message: string;
    type?: string;
    linkScreen?: string | null;
    linkEntityId?: number | null;
  }
): void {
  db.prepare(
    `INSERT INTO notifications (user_id, title, message, type, link_screen, link_entity_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    params.userId,
    params.title,
    params.message,
    params.type ?? "info",
    params.linkScreen ?? null,
    params.linkEntityId ?? null
  );
}

