import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evaldesk-test-"));
process.env.EVALDESK_DB_PATH = path.join(tmpDir, "test.db");

import { handleApiRequest } from "../app.ts";
import { closeDb } from "../db.ts";
import { generatePdfBuffer } from "../pdf.ts";

let server: http.Server;
let baseUrl = "";
let teacherToken = "";
let studentToken = "";
let otherStudentToken = "";

async function api(
  pathname: string,
  opts: { method?: string; token?: string; body?: unknown; rawBody?: Buffer; contentType?: string } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  let payload: BodyInit | undefined;
  if (opts.rawBody) {
    payload = new Uint8Array(opts.rawBody);
    if (opts.contentType) headers["Content-Type"] = opts.contentType;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }

  const res = await fetch(`${baseUrl}${pathname}`, {
    method: opts.method || "GET",
    headers,
    body: payload,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // binary or csv
  }
  return { status: res.status, headers: res.headers, text, json };
}

function buildMultipart(fieldName: string, fileName: string, mimeType: string, content: Buffer) {
  const boundary = "----EvalDeskTestBoundary789";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    boundary,
    body: Buffer.concat([head, content, tail]),
  };
}

before(async () => {
  server = http.createServer(async (req, res) => {
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end("Not found");
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("1. Authentication, demo login, and invalid password rejection", async () => {
  const unauth = await api("/api/teacher/dashboard");
  assert.equal(unauth.status, 401);

  const badLogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: "mahmud.rahman@stamforduniversity.edu.bd", password: "wrong" },
  });
  assert.equal(badLogin.status, 401);

  const tLogin = await api("/api/auth/login", {
    method: "POST",
    body: { demoRole: "teacher" },
  });
  assert.equal(tLogin.status, 200);
  assert.equal(tLogin.json.user.role, "teacher");
  teacherToken = tLogin.json.token;

  const sLogin = await api("/api/auth/login", {
    method: "POST",
    body: { demoRole: "student" },
  });
  assert.equal(sLogin.status, 200);
  assert.equal(sLogin.json.user.role, "student");
  studentToken = sLogin.json.token;

  const s2Login = await api("/api/auth/login", {
    method: "POST",
    body: { email: "nusrat.jahan@stamforduniversity.edu.bd", password: "Student@2026" },
  });
  assert.equal(s2Login.status, 200);
  otherStudentToken = s2Login.json.token;
});

test("2. Authorization & student privacy isolation", async () => {
  // Student cannot access teacher dashboard or create courses
  const dashRes = await api("/api/teacher/dashboard", { token: studentToken });
  assert.equal(dashRes.status, 403);

  const courseRes = await api("/api/courses", {
    method: "POST",
    token: studentToken,
    body: { code: "CSE 999", title: "Unauthorized" },
  });
  assert.equal(courseRes.status, 403);

  // Student cannot access another student's submission or unpublished exam submissions
  const dsSubs = await api("/api/exams/1/submissions", { token: teacherToken });
  assert.equal(dsSubs.status, 200);
  const unpublishedSubId = dsSubs.json.submissions[0].id;
  const studentForbiddenSub = await api(`/api/submissions/${unpublishedSubId}`, {
    token: studentToken,
  });
  assert.equal(studentForbiddenSub.status, 403);

  // On published DBMS Quiz (exam 2), student 1 cannot access student 2's submission
  const dbmsSubs = await api("/api/exams/2/submissions", { token: teacherToken });
  const nusratSub = dbmsSubs.json.submissions.find(
    (s: any) => s.student_id_number === "CSE22002"
  );
  const crossStudent = await api(`/api/submissions/${nusratSub.id}`, { token: studentToken });
  assert.equal(crossStudent.status, 403);
});

test("3. Full Exam Creation -> Rubric Validation -> PDF Upload -> Deterministic Scoring -> Approval -> Publish", async () => {
  const coursesRes = await api("/api/courses", { token: teacherToken });
  const courseId = coursesRes.json.courses[0].id;

  // Create exam
  const createRes = await api("/api/exams", {
    method: "POST",
    token: teacherToken,
    body: {
      courseId,
      title: "Unit Test Midterm",
      examDate: "2026-11-12",
      totalMarks: 25,
      passThreshold: 40,
      totalQuestions: 4,
    },
  });
  assert.equal(createRes.status, 201);
  const examId = createRes.json.exam.id;

  // Rubric mismatch must fail
  const badRubric = await api(`/api/exams/${examId}/questions`, {
    method: "PUT",
    token: teacherToken,
    body: {
      verify: true,
      questions: [
        {
          question_number: 1,
          question_text: "MCQ Q1",
          question_type: "MCQ",
          max_marks: 5,
          reference_answer: "O(1)",
          rubrics: [{ criterion_name: "Choice", max_marks: 3 }],
        },
      ],
    },
  });
  assert.equal(badRubric.status, 400);

  // Total question marks mismatch exam total must fail verify
  const badTotal = await api(`/api/exams/${examId}/questions`, {
    method: "PUT",
    token: teacherToken,
    body: {
      verify: true,
      questions: [
        {
          question_number: 1,
          question_text: "MCQ Q1",
          question_type: "MCQ",
          max_marks: 5,
          reference_answer: "O(1)",
          rubrics: [{ criterion_name: "Choice", max_marks: 5 }],
        },
      ],
    },
  });
  assert.equal(badTotal.status, 400);

  // Valid questions & rubrics totaling 25 marks
  const validKey = await api(`/api/exams/${examId}/questions`, {
    method: "PUT",
    token: teacherToken,
    body: {
      verify: true,
      questions: [
        {
          question_number: 1,
          question_text: "Head insert complexity?",
          question_type: "MCQ",
          max_marks: 5,
          reference_answer: "O(1)",
          rubrics: [{ criterion_name: "Choice", max_marks: 5 }],
        },
        {
          question_number: 2,
          question_text: "Stack is LIFO?",
          question_type: "True/False",
          max_marks: 5,
          reference_answer: "True",
          rubrics: [{ criterion_name: "Boolean", max_marks: 5 }],
        },
        {
          question_number: 3,
          question_text: "Compute 20 + 22",
          question_type: "Numerical",
          max_marks: 5,
          reference_answer: "42",
          numerical_tolerance: 0.5,
          rubrics: [{ criterion_name: "Calculation", max_marks: 5 }],
        },
        {
          question_number: 4,
          question_text: "Define recursion.",
          question_type: "Short Answer",
          max_marks: 10,
          reference_answer: "A function calling itself with a base case.",
          rubrics: [
            { criterion_name: "Self-call", max_marks: 5 },
            { criterion_name: "Base case", max_marks: 5 },
          ],
        },
      ],
    },
  });
  assert.equal(validKey.status, 200);
  assert.equal(validKey.json.exam.status, "Ready for Upload");

  // Generate a real PDF answer script for CSE22001 Arif Hasan
  const scriptPdf = generatePdfBuffer([
    {
      header: "Stamford University Bangladesh — Answer Sheet",
      subheader: "Student: Arif Hasan (CSE22001)",
      lines: [
        "1. O(1)",
        "2. True",
        "3. 42",
        "4. Recursion occurs when a function calls itself until reaching a base condition.",
      ],
    },
  ]);

  const mp = buildMultipart("sheets", "CSE22001_Script.pdf", "application/pdf", scriptPdf);
  const uploadRes = await api(`/api/exams/${examId}/sheets`, {
    method: "POST",
    token: teacherToken,
    rawBody: mp.body,
    contentType: `multipart/form-data; boundary=${mp.boundary}`,
  });
  assert.equal(uploadRes.status, 200);
  assert.equal(uploadRes.json.results[0].status, "Uploaded");
  const subId = uploadRes.json.results[0].submission.id;

  // Duplicate upload must be detected
  const dupRes = await api(`/api/exams/${examId}/sheets`, {
    method: "POST",
    token: teacherToken,
    rawBody: mp.body,
    contentType: `multipart/form-data; boundary=${mp.boundary}`,
  });
  assert.equal(dupRes.status, 200);
  assert.equal(dupRes.json.results[0].status, "Duplicate");

  // Run evaluation pipeline
  const evalRes = await api(`/api/exams/${examId}/evaluate`, {
    method: "POST",
    token: teacherToken,
  });
  assert.equal(evalRes.status, 200);

  // Verify deterministic grading scored Q1=5, Q2=5, Q3=5 (total 15) and Q4 flagged Manual Review Required (0)
  const subDetail = await api(`/api/submissions/${subId}`, { token: teacherToken });
  assert.equal(subDetail.status, 200);
  const evals = subDetail.json.evaluations;
  assert.equal(evals[0].suggested_marks, 5);
  assert.equal(evals[1].suggested_marks, 5);
  assert.equal(evals[2].suggested_marks, 5);
  assert.equal(evals[3].review_status, "Manual Review Required");

  // Publishing before teacher approval must fail
  const prematurePublish = await api(`/api/exams/${examId}/publish`, {
    method: "POST",
    token: teacherToken,
  });
  assert.equal(prematurePublish.status, 400);

  // Teacher manually grades Q4 = 9 and approves student
  const q4Id = evals[3].question_id;
  const gradeQ4 = await api(`/api/submissions/${subId}/questions/${q4Id}`, {
    method: "PUT",
    token: teacherToken,
    body: {
      approvedMarks: 9,
      teacherFeedback: "Clear base case explanation.",
      markReviewed: true,
    },
  });
  assert.equal(gradeQ4.status, 200);
  assert.equal(gradeQ4.json.totalApproved, 24);

  const approveSub = await api(`/api/submissions/${subId}/approve`, {
    method: "POST",
    token: teacherToken,
    body: { teacherOverallFeedback: "Great work!" },
  });
  assert.equal(approveSub.status, 200);
  assert.equal(approveSub.json.totalApproved, 24);
  assert.equal(approveSub.json.examStatus, "Ready to Publish");

  // Now Publish succeeds
  const pubRes = await api(`/api/exams/${examId}/publish`, {
    method: "POST",
    token: teacherToken,
  });
  assert.equal(pubRes.status, 200);
  assert.equal(pubRes.json.exam.status, "Published");

  // Student can now view published submission (without seeing unapproved AI fields)
  const stuView = await api(`/api/submissions/${subId}`, { token: studentToken });
  assert.equal(stuView.status, 200);
  assert.equal(stuView.json.submission.total_approved_marks, 24);
  assert.equal(stuView.json.evaluations[0].suggested_marks, undefined);

  // Post-publication mark modification requires correctionReason
  const unAuditedEdit = await api(`/api/submissions/${subId}/questions/${q4Id}`, {
    method: "PUT",
    token: teacherToken,
    body: { approvedMarks: 10 },
  });
  assert.equal(unAuditedEdit.status, 400);

  const auditedEdit = await api(`/api/submissions/${subId}/questions/${q4Id}`, {
    method: "PUT",
    token: teacherToken,
    body: { approvedMarks: 10, correctionReason: "Awarded full credit after review." },
  });
  assert.equal(auditedEdit.status, 200);
  assert.equal(auditedEdit.json.totalApproved, 25);

  // CSV & PDF exports
  const csvRes = await api(`/api/exams/${examId}/export/csv?type=results`, { token: teacherToken });
  assert.equal(csvRes.status, 200);
  assert.ok(csvRes.text.includes("CSE22001"));

  const pdfRes = await api(`/api/exams/${examId}/export/pdf`, { token: teacherToken });
  assert.equal(pdfRes.status, 200);
  assert.ok(pdfRes.text.startsWith("%PDF-1.4"));

  const stuPdfRes = await api(`/api/submissions/${subId}/feedback-pdf`, { token: studentToken });
  assert.equal(stuPdfRes.status, 200);
  assert.ok(stuPdfRes.text.startsWith("%PDF-1.4"));
});

test("4. Recheck request submission, duplicate prevention, and teacher resolution", async () => {
  // Arif submits recheck on DBMS Quiz (exam 2) Q4
  const dbmsDetail = await api("/api/exams/2", { token: studentToken });
  const q4 = dbmsDetail.json.questions.find((q: any) => q.question_number === 4);

  const rcCreate = await api("/api/rechecks", {
    method: "POST",
    token: studentToken,
    body: {
      examId: 2,
      questionId: q4.id,
      reason: "My answer may include a valid alternative",
      comment: "Please review my isolation point.",
    },
  });
  assert.equal(rcCreate.status, 201);
  const rcId = rcCreate.json.recheck.id;

  // Duplicate active recheck request must fail with 409
  const rcDup = await api("/api/rechecks", {
    method: "POST",
    token: studentToken,
    body: {
      examId: 2,
      questionId: q4.id,
      reason: "Duplicate check",
    },
  });
  assert.equal(rcDup.status, 409);

  // Teacher resolves with adjusted marks 4/5 (was 2/5)
  const rcResolve = await api(`/api/rechecks/${rcId}`, {
    method: "PUT",
    token: teacherToken,
    body: {
      status: "Resolved",
      adjustedMarks: 4,
      teacherResponse: "Partial credit increased for Isolation clarity.",
    },
  });
  assert.equal(rcResolve.status, 200);
  assert.equal(rcResolve.json.recheck.status, "Resolved");
  assert.equal(rcResolve.json.recheck.original_marks, 2);
  assert.equal(rcResolve.json.recheck.adjusted_marks, 4);

  // Student sees updated submission score (17 -> 19)
  const studentDash = await api("/api/student/dashboard", { token: studentToken });
  const dbmsExam = studentDash.json.exams.find((e: any) => e.id === 2);
  assert.equal(dbmsExam.obtained_marks, 19);
});

test("5. Student self-signup & Teacher ID registry loophole protection", async () => {
  // Student cannot register with a faculty Teacher ID format
  const badStudentSid = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "student",
      name: "Sneaky Student",
      email: "sneaky@stamforduniversity.edu.bd",
      password: "Password@123",
      studentIdNumber: "FAC-CSE-102",
    },
  });
  assert.equal(badStudentSid.status, 400);

  // Valid Student self-signup succeeds
  const okStudent = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "student",
      name: "Rakibul Islam",
      email: "rakibul.islam@stamforduniversity.edu.bd",
      password: "Password@123",
      studentIdNumber: "CSE22099",
    },
  });
  assert.equal(okStudent.status, 201);
  assert.equal(okStudent.json.user.role, "student");
  assert.equal(okStudent.json.user.student_id_number, "CSE22099");

  // Fake Teacher ID must be rejected (prevents students claiming teacher role)
  const fakeTeacher = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      name: "Fake Faculty",
      email: "fake.faculty@stamforduniversity.edu.bd",
      password: "Password@123",
      teacherIdNumber: "FAC-FAKE-999",
    },
  });
  assert.equal(fakeTeacher.status, 403);

  // Already claimed Teacher ID (FAC-CSE-101) must be rejected
  const claimedTeacher = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      name: "Hijack Attempt",
      email: "hijack@stamforduniversity.edu.bd",
      password: "Password@123",
      teacherIdNumber: "FAC-CSE-101",
    },
  });
  assert.equal(claimedTeacher.status, 409);

  // Valid unclaimed Teacher ID (FAC-CSE-102) succeeds and locks the ID
  const validTeacher = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      name: "Dr. Farhana Yasmin",
      email: "farhana.yasmin@stamforduniversity.edu.bd",
      password: "Password@123",
      teacherIdNumber: "FAC-CSE-102",
      designation: "Assistant Professor",
    },
  });
  assert.equal(validTeacher.status, 201);
  assert.equal(validTeacher.json.user.role, "teacher");
  assert.equal(validTeacher.json.user.teacher_id_number, "FAC-CSE-102");

  // Second attempt to reuse FAC-CSE-102 must fail
  const reuseTeacher = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      name: "Second Person",
      email: "second.person@stamforduniversity.edu.bd",
      password: "Password@123",
      teacherIdNumber: "FAC-CSE-102",
    },
  });
  assert.equal(reuseTeacher.status, 409);

  // Existing teacher issues a new email-bound Teacher ID FAC-CSE-105
  const issueRes = await api("/api/teacher/faculty-registry", {
    method: "POST",
    token: teacherToken,
    body: {
      teacherIdNumber: "FAC-CSE-105",
      expectedEmail: "karim.uddin@stamforduniversity.edu.bd",
      designation: "Lecturer",
    },
  });
  assert.equal(issueRes.status, 201);

  // Mismatched email for bound Teacher ID is rejected
  const wrongEmailRes = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      name: "Wrong Email User",
      email: "other@stamforduniversity.edu.bd",
      password: "Password@123",
      teacherIdNumber: "FAC-CSE-105",
    },
  });
  assert.equal(wrongEmailRes.status, 403);

  // Matching email succeeds
  const rightEmailRes = await api("/api/auth/register", {
    method: "POST",
    body: {
      role: "teacher",
      name: "Karim Uddin",
      email: "karim.uddin@stamforduniversity.edu.bd",
      password: "Password@123",
      teacherIdNumber: "FAC-CSE-105",
    },
  });
  assert.equal(rightEmailRes.status, 201);
});

