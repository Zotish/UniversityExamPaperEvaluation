import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "./auth.ts";
import { createNotification, getUploadDir, logAudit } from "./db.ts";
import { generatePdfBuffer } from "./pdf.ts";

function saveGeneratedPdf(
  db: DatabaseSync,
  params: {
    originalName: string;
    uploadedBy: number;
    docKind: "answer_key" | "student_sheet";
    pages: { header?: string; subheader?: string; lines: string[] }[];
  }
): number {
  const buffer = generatePdfBuffer(params.pages);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const storedName = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}_${params.originalName}`;
  const fullPath = path.join(getUploadDir(), storedName);
  fs.writeFileSync(fullPath, buffer);

  const res = db
    .prepare(
      `INSERT INTO uploaded_documents (original_name, stored_name, mime_type, size_bytes, sha256, page_count, uploaded_by, doc_kind)
       VALUES (?, ?, 'application/pdf', ?, ?, ?, ?, ?)`
    )
    .run(
      params.originalName,
      storedName,
      buffer.length,
      sha256,
      params.pages.length,
      params.uploadedBy,
      params.docKind
    );

  return Number(res.lastInsertRowid);
}

export function seedDatabaseIfEmpty(db: DatabaseSync): void {
  const countRow = db.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number };
  if (countRow.cnt > 0) {
    // Ensure pre-approved faculty Teacher IDs exist even on pre-existing databases
    const regCount = db
      .prepare("SELECT COUNT(*) as cnt FROM faculty_registry")
      .get() as { cnt: number };
    if (regCount.cnt === 0) {
      const existingTeacher = db
        .prepare("SELECT id, name, email, department, designation FROM users WHERE role = 'teacher' ORDER BY id ASC LIMIT 1")
        .get() as
        | { id: number; name: string; email: string; department: string; designation: string | null }
        | undefined;
      if (existingTeacher) {
        db.prepare("UPDATE users SET teacher_id_number = COALESCE(teacher_id_number, 'FAC-CSE-101') WHERE id = ?").run(
          existingTeacher.id
        );
        db.prepare(
          `INSERT OR IGNORE INTO faculty_registry (teacher_id_number, full_name, expected_email, department, designation, claimed_by_user_id)
           VALUES ('FAC-CSE-101', ?, ?, ?, ?, ?)`
        ).run(
          existingTeacher.name,
          existingTeacher.email,
          existingTeacher.department,
          existingTeacher.designation || "Associate Professor",
          existingTeacher.id
        );
      }
      const defaults = [
        ["FAC-CSE-102", null, null, "Computer Science and Engineering", "Lecturer"],
        ["FAC-CSE-103", null, null, "Computer Science and Engineering", "Assistant Professor"],
        ["FAC-CSE-104", null, null, "Computer Science and Engineering", "Assistant Professor"],
      ] as const;
      for (const [tid, fn, em, dept, desig] of defaults) {
        db.prepare(
          `INSERT OR IGNORE INTO faculty_registry (teacher_id_number, full_name, expected_email, department, designation)
           VALUES (?, ?, ?, ?, ?)`
        ).run(tid, fn, em, dept, desig);
      }
    }
    return;
  }

  const teacherPass = hashPassword("EvalDesk@2026");
  const studentPass = hashPassword("Student@2026");

  // 1. Users (Stamford University Bangladesh, CSE)
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, name, role, department, designation, student_id_number, teacher_id_number, avatar_initials)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const teacherId = Number(
    insertUser.run(
      "mahmud.rahman@stamforduniversity.edu.bd",
      teacherPass,
      "Dr. Mahmud Rahman",
      "teacher",
      "Computer Science and Engineering",
      "Associate Professor",
      null,
      "FAC-CSE-101",
      "MR"
    ).lastInsertRowid
  );

  const insertRegistry = db.prepare(
    `INSERT INTO faculty_registry (teacher_id_number, full_name, expected_email, department, designation, claimed_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertRegistry.run(
    "FAC-CSE-101",
    "Dr. Mahmud Rahman",
    "mahmud.rahman@stamforduniversity.edu.bd",
    "Computer Science and Engineering",
    "Associate Professor",
    teacherId
  );
  insertRegistry.run(
    "FAC-CSE-102",
    null,
    null,
    "Computer Science and Engineering",
    "Lecturer",
    null
  );
  insertRegistry.run(
    "FAC-CSE-103",
    null,
    null,
    "Computer Science and Engineering",
    "Assistant Professor",
    null
  );
  insertRegistry.run(
    "FAC-CSE-104",
    null,
    null,
    "Computer Science and Engineering",
    "Assistant Professor",
    null
  );

  const studentDefs = [
    ["arif.hasan@stamforduniversity.edu.bd", "Arif Hasan", "CSE22001", "AH"],
    ["nusrat.jahan@stamforduniversity.edu.bd", "Nusrat Jahan", "CSE22002", "NJ"],
    ["tanvir.ahmed@stamforduniversity.edu.bd", "Tanvir Ahmed", "CSE22003", "TA"],
    ["sadia.islam@stamforduniversity.edu.bd", "Sadia Islam", "CSE22004", "SI"],
    ["fahim.rahman@stamforduniversity.edu.bd", "Fahim Rahman", "CSE22005", "FR"],
  ] as const;

  const studentIds: Record<string, number> = {};
  for (const [email, name, sid, initials] of studentDefs) {
    studentIds[sid] = Number(
      insertUser.run(
        email,
        studentPass,
        name,
        "student",
        "Computer Science and Engineering",
        "Undergraduate Student",
        sid,
        null,
        initials
      ).lastInsertRowid
    );
  }

  // 2. Courses
  const insertCourse = db.prepare(
    `INSERT INTO courses (code, title, department, semester, teacher_id, description)
     VALUES (?, ?, 'Computer Science and Engineering', ?, ?, ?)`
  );

  const dsCourseId = Number(
    insertCourse.run(
      "CSE 214",
      "Data Structures",
      "Fall 2026",
      teacherId,
      "Linear and non-linear data structures, recursion, trees, graphs, and complexity analysis."
    ).lastInsertRowid
  );
  const dbmsCourseId = Number(
    insertCourse.run(
      "CSE 321",
      "Database Management Systems",
      "Fall 2026",
      teacherId,
      "Relational algebra, SQL, normalization, indexing, transaction management, and recovery."
    ).lastInsertRowid
  );
  const algoCourseId = Number(
    insertCourse.run(
      "CSE 313",
      "Algorithms",
      "Fall 2026",
      teacherId,
      "Divide and conquer, greedy methods, dynamic programming, and graph algorithms."
    ).lastInsertRowid
  );
  const oopCourseId = Number(
    insertCourse.run(
      "CSE 211",
      "Object-Oriented Programming",
      "Spring 2026",
      teacherId,
      "Classes, inheritance, polymorphism, exception handling, and design patterns."
    ).lastInsertRowid
  );
  const seCourseId = Number(
    insertCourse.run(
      "CSE 325",
      "Software Engineering",
      "Fall 2026",
      teacherId,
      "SDLC models, requirements engineering, architecture, testing, and quality assurance."
    ).lastInsertRowid
  );

  // Enroll all 5 students in all 5 courses
  const insertEnroll = db.prepare(
    `INSERT INTO course_enrollments (course_id, student_id) VALUES (?, ?)`
  );
  for (const cid of [dsCourseId, dbmsCourseId, algoCourseId, oopCourseId, seCourseId]) {
    for (const sid of Object.values(studentIds)) {
      insertEnroll.run(cid, sid);
    }
  }

  // =========================================================================
  // EXAM 1: Data Structures Midterm 2026 (Needs Review — 3 Approved, 2 Flagged)
  // =========================================================================
  const dsKeyDocId = saveGeneratedPdf(db, {
    originalName: "DEMO_Answer_Key_CSE214_Midterm.pdf",
    uploadedBy: teacherId,
    docKind: "answer_key",
    pages: [
      {
        header: "Stamford University Bangladesh — Official Answer Key (DEMO DATA)",
        subheader: "Dept. of CSE · Course: CSE 214 (Data Structures) · Midterm 2026 · Total: 50",
        lines: [
          "1. What is the time complexity of inserting at the head of a singly linked list?",
          "Answer: O(1)",
          "",
          "2. A binary search tree always maintains worst-case O(log n) search height. (True/False)",
          "Answer: False",
          "",
          "3. Calculate the array index of element A[4] when base address is 1000 and element size is 4 bytes (0-indexed).",
          "Answer: 1016",
          "",
          "4. Explain the difference between Stack and Queue.",
          "Answer: A stack follows LIFO (Last In, First Out) using push and pop operations, whereas a queue follows FIFO (First In, First Out) using enqueue and dequeue operations. Examples: stack of plates and ticket counter queue.",
          "",
          "5. Describe how Breadth-First Search (BFS) traverses a graph and state its auxiliary data structure.",
          "Answer: BFS explores vertices level by level starting from the source node using a Queue and a visited array/set, yielding O(V + E) time complexity with adjacency lists.",
        ],
      },
    ],
  });

  const dsExamId = Number(
    db
      .prepare(
        `INSERT INTO examinations (course_id, title, exam_date, total_marks, pass_threshold, total_questions, status, answer_key_verified, answer_key_file_id, created_by)
         VALUES (?, 'Data Structures Midterm 2026 [DEMO]', '2026-10-12', 50, 40, 5, 'Needs Review', 1, ?, ?)`
      )
      .run(dsCourseId, dsKeyDocId, teacherId).lastInsertRowid
  );

  const insertQ = db.prepare(
    `INSERT INTO questions (exam_id, question_number, question_text, question_type, max_marks, reference_answer, alternative_answers_json, numerical_tolerance, topic, page_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertRubric = db.prepare(
    `INSERT INTO marking_rubrics (question_id, criterion_name, max_marks, sort_order) VALUES (?, ?, ?, ?)`
  );

  const dsQ1 = Number(
    insertQ.run(
      dsExamId,
      1,
      "What is the time complexity of inserting a new node at the head of a singly linked list?",
      "MCQ",
      10,
      "O(1)",
      JSON.stringify(["Constant time", "A) O(1)", "O(1) constant"]),
      0,
      "Linked Lists",
      1
    ).lastInsertRowid
  );
  insertRubric.run(dsQ1, "Correct Time Complexity Selection", 10, 0);

  const dsQ2 = Number(
    insertQ.run(
      dsExamId,
      2,
      "True or False: An unbalanced Binary Search Tree guarantees worst-case O(log n) search time.",
      "True/False",
      10,
      "False",
      JSON.stringify(["F", "No"]),
      0,
      "Binary Search Trees",
      1
    ).lastInsertRowid
  );
  insertRubric.run(dsQ2, "Accurate Boolean Evaluation", 10, 0);

  const dsQ3 = Number(
    insertQ.run(
      dsExamId,
      3,
      "Calculate the memory address of A[4] in a 0-indexed integer array if base address = 1000 and element size = 4 bytes.",
      "Numerical",
      10,
      "1016",
      JSON.stringify(["1016 bytes"]),
      0,
      "Arrays & Memory Layout",
      2
    ).lastInsertRowid
  );
  insertRubric.run(dsQ3, "Correct Memory Address Calculation", 10, 0);

  const dsQ4 = Number(
    insertQ.run(
      dsExamId,
      4,
      "Explain Stack and Queue with their operating principles and examples.",
      "Descriptive",
      10,
      "A stack is a linear data structure following LIFO (Last In, First Out) with push and pop operations (e.g., plate stack). A queue follows FIFO (First In, First Out) with enqueue and dequeue operations (e.g., waiting line).",
      JSON.stringify(["LIFO stack and FIFO queue with operations and real-world examples"]),
      0,
      "Stack and Queue",
      2
    ).lastInsertRowid
  );
  insertRubric.run(dsQ4, "Correct Stack Definition", 3, 0);
  insertRubric.run(dsQ4, "Correct Queue Definition", 3, 1);
  insertRubric.run(dsQ4, "LIFO/FIFO Explanation", 2, 2);
  insertRubric.run(dsQ4, "Appropriate Example", 2, 3);

  const dsQ5 = Number(
    insertQ.run(
      dsExamId,
      5,
      "Explain Breadth-First Search (BFS) traversal, its auxiliary data structure, and time complexity.",
      "Short Answer",
      10,
      "BFS visits nodes level by level from a source vertex using a FIFO Queue and a visited set to prevent cycles, running in O(V + E) time for adjacency lists.",
      JSON.stringify(["Level-order graph traversal with queue in O(V+E)"]),
      0,
      "Graph Traversal",
      3
    ).lastInsertRowid
  );
  insertRubric.run(dsQ5, "Level-by-level Traversal Logic", 4, 0);
  insertRubric.run(dsQ5, "Queue & Visited Set Usage", 4, 1);
  insertRubric.run(dsQ5, "Time Complexity O(V + E)", 2, 2);

  // Student scripts for Data Structures Midterm
  const dsStudentsData = [
    {
      sid: "CSE22001",
      name: "Arif Hasan",
      approved: true,
      total: 43,
      overallFeedback: "Strong grasp of linear structures and BFS. Review FIFO example clarity on Q4.",
      answers: [
        { qId: dsQ1, ans: "O(1)", marks: 10, page: 1, status: "Teacher Approved", method: "Deterministic-MCQ", ok: ["Selected O(1) constant time."], miss: [], fb: "Exact match." },
        { qId: dsQ2, ans: "False", marks: 10, page: 1, status: "Teacher Approved", method: "Deterministic-TF", ok: ["Correctly identified as False."], miss: [], fb: "Correct. Skewed BST takes O(n)." },
        { qId: dsQ3, ans: "1000 + 4 * 4 = 1016", marks: 10, page: 2, status: "Teacher Approved", method: "Deterministic-Numerical", ok: ["Computed 1016 accurately."], miss: [], fb: "Accurate calculation." },
        { qId: dsQ4, ans: "A stack follows LIFO using push and pop, like a stack of books. A queue follows FIFO where elements wait in a line.", marks: 7, page: 2, status: "Teacher Approved", method: "Demo-Preloaded", ok: ["Stack LIFO and push/pop explained.", "Queue FIFO concept identified."], miss: ["Did not mention enqueue/dequeue operations explicitly.", "Missing a concrete queue real-world example."], fb: "Good definitions; include enqueue/dequeue terminology." },
        { qId: dsQ5, ans: "BFS explores neighbors level by level using a Queue and visited array. Complexity is O(V + E) with adjacency list.", marks: 6, page: 3, status: "Teacher Approved", method: "Demo-Preloaded", ok: ["Queue usage and O(V + E) complexity stated."], miss: ["Briefly note why visited tracking prevents infinite loops in cyclic graphs."], fb: "Solid explanation; mention cycle prevention." },
      ],
    },
    {
      sid: "CSE22002",
      name: "Nusrat Jahan",
      approved: true,
      total: 46,
      overallFeedback: "Excellent, concise technical explanations across all questions.",
      answers: [
        { qId: dsQ1, ans: "O(1)", marks: 10, page: 1, status: "Teacher Approved", method: "Deterministic-MCQ", ok: ["Correct O(1) answer."], miss: [], fb: "Correct." },
        { qId: dsQ2, ans: "False", marks: 10, page: 1, status: "Teacher Approved", method: "Deterministic-TF", ok: ["Correct."], miss: [], fb: "Correct." },
        { qId: dsQ3, ans: "1016", marks: 10, page: 2, status: "Teacher Approved", method: "Deterministic-Numerical", ok: ["Exact address 1016."], miss: [], fb: "Correct." },
        { qId: dsQ4, ans: "Stack uses LIFO with push and pop (e.g., undo history). Queue uses FIFO with enqueue and dequeue (e.g., printer job queue).", marks: 9, page: 2, status: "Teacher Approved", method: "Demo-Preloaded", ok: ["Clear LIFO/FIFO principles, operations, and examples."], miss: ["State both are linear structures explicitly."], fb: "Very strong answer." },
        { qId: dsQ5, ans: "BFS traverses layer by layer via a FIFO queue and visited array to avoid revisiting nodes. Runs in O(V+E).", marks: 7, page: 3, status: "Teacher Approved", method: "Demo-Preloaded", ok: ["All three rubric areas covered."], miss: ["Explain shortest-path property on unweighted graphs for completeness."], fb: "Well written." },
      ],
    },
    {
      sid: "CSE22003",
      name: "Tanvir Ahmed",
      approved: false,
      total: 35,
      overallFeedback: "",
      answers: [
        { qId: dsQ1, ans: "O(1)", marks: 10, page: 1, status: "Ready for Review", method: "Deterministic-MCQ", ok: ["Selected O(1)."], miss: [], fb: "Correct MCQ choice." },
        { qId: dsQ2, ans: "False", marks: 10, page: 1, status: "Ready for Review", method: "Deterministic-TF", ok: ["Correctly answered False."], miss: [], fb: "Correct True/False." },
        { qId: dsQ3, ans: "101?", marks: 0, page: 2, status: "Extraction Uncertain", method: "Manual", ok: [], miss: ["Last digit unclear in handwriting extraction ('101?')."], fb: "Uncertain digit extraction detected. Please inspect page 2 of Tanvir Ahmed's script." },
        { qId: dsQ4, ans: "Stack stores items one over another and the first item inserted is removed first, like plates. Queue is also a list.", marks: 6, page: 2, status: "Ready for Review", method: "Demo-Preloaded", ok: ["Provided plate example."], miss: ["Reversed LIFO definition (described FIFO instead).", "Incomplete queue explanation."], fb: "LIFO means Last In, First Out—not first inserted removed first." },
        { qId: dsQ5, ans: "BFS explores adjacent nodes level by level with a Queue in O(V + E).", marks: 9, page: 3, status: "Ready for Review", method: "Demo-Preloaded", ok: ["Correct level traversal, queue, and O(V + E)."], miss: ["Mention visited set."], fb: "Good concise summary." },
      ],
    },
    {
      sid: "CSE22004",
      name: "Sadia Islam",
      approved: true,
      total: 40,
      overallFeedback: "Good overall accuracy; revise BST worst-case behavior.",
      answers: [
        { qId: dsQ1, ans: "O(1)", marks: 10, page: 1, status: "Teacher Approved", method: "Deterministic-MCQ", ok: ["Correct."], miss: [], fb: "Correct." },
        { qId: dsQ2, ans: "True", marks: 0, page: 1, status: "Teacher Approved", method: "Deterministic-TF", ok: [], miss: ["Unbalanced BST degrades to O(n) like a linked list."], fb: "Incorrect. Only balanced trees (AVL/Red-Black) guarantee O(log n)." },
        { qId: dsQ3, ans: "1016", marks: 10, page: 2, status: "Teacher Approved", method: "Deterministic-Numerical", ok: ["Correct 1016."], miss: [], fb: "Correct." },
        { qId: dsQ4, ans: "Stack is LIFO (push/pop) e.g. browser back stack. Queue is FIFO (enqueue/dequeue) e.g. call center queue.", marks: 10, page: 2, status: "Teacher Approved", method: "Demo-Preloaded", ok: ["Full rubric satisfaction."], miss: [], fb: "Complete and clear." },
        { qId: dsQ5, ans: "BFS uses a Queue and visited boolean array to explore each level in O(V+E).", marks: 10, page: 3, status: "Teacher Approved", method: "Demo-Preloaded", ok: ["All concepts demonstrated."], miss: [], fb: "Excellent." },
      ],
    },
    {
      sid: "CSE22005",
      name: "Fahim Rahman",
      approved: false,
      total: 32,
      overallFeedback: "",
      answers: [
        { qId: dsQ1, ans: "O(n)", marks: 0, page: 1, status: "Ready for Review", method: "Deterministic-MCQ", ok: [], miss: ["Head insertion requires no traversal; it is O(1)."], fb: "Incorrect option." },
        { qId: dsQ2, ans: "False", marks: 10, page: 1, status: "Ready for Review", method: "Deterministic-TF", ok: ["Correct False."], miss: [], fb: "Correct." },
        { qId: dsQ3, ans: "1016", marks: 10, page: 2, status: "Ready for Review", method: "Deterministic-Numerical", ok: ["Correct 1016."], miss: [], fb: "Correct." },
        { qId: dsQ4, ans: "Stack puts elements on top and takes from top (LIFO). Queue inserts at rear and removes from front (FIFO).", marks: 6, page: 2, status: "Ready for Review", method: "Demo-Preloaded", ok: ["Correct LIFO & FIFO mechanics."], miss: ["Missing real-world examples and operation names."], fb: "Add concrete examples." },
        { qId: dsQ5, ans: "BFS traverses by expanding frontier waves using a FIFO buffer and marker table so vertices are visited once.", marks: 6, page: 3, status: "Rubric Match Uncertain", method: "Demo-Preloaded", ok: ["Used valid alternative phrasing ('frontier waves', 'FIFO buffer', 'marker table')."], miss: ["Missing O(V + E) time complexity."], fb: "Alternative phrasing detected; teacher verification needed to confirm full conceptual credit." },
      ],
    },
  ];

  const insertSub = db.prepare(
    `INSERT INTO submissions (exam_id, student_id, document_id, detected_student_name, detected_student_id, upload_status, processing_status, review_status, total_suggested_marks, total_approved_marks, teacher_overall_feedback, approved_by, approved_at)
     VALUES (?, ?, ?, ?, ?, 'Uploaded', ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertQE = db.prepare(
    `INSERT INTO question_evaluations (submission_id, question_id, extracted_answer, page_reference, extraction_status, suggested_marks, approved_marks, rubric_scores_json, correct_concepts_json, missing_concepts_json, misconceptions_json, ai_feedback, teacher_feedback, evaluation_method, review_status, flagged, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const stu of dsStudentsData) {
    const docId = saveGeneratedPdf(db, {
      originalName: `${stu.sid}_CSE214_Midterm_DEMO.pdf`,
      uploadedBy: teacherId,
      docKind: "student_sheet",
      pages: [
        {
          header: "Stamford University Bangladesh — Student Answer Script (DEMO)",
          subheader: `Student: ${stu.name} (${stu.sid}) · Course: CSE 214 · Midterm 2026`,
          lines: [
            `1. ${stu.answers[0].ans}`,
            "",
            `2. ${stu.answers[1].ans}`,
          ],
        },
        {
          header: "Stamford University Bangladesh — Answer Script (Page 2)",
          subheader: `Student: ${stu.name} (${stu.sid}) · CSE 214`,
          lines: [
            `3. ${stu.answers[2].ans}`,
            "",
            `4. ${stu.answers[3].ans}`,
          ],
        },
        {
          header: "Stamford University Bangladesh — Answer Script (Page 3)",
          subheader: `Student: ${stu.name} (${stu.sid}) · CSE 214`,
          lines: [`5. ${stu.answers[4].ans}`],
        },
      ],
    });

    const subId = Number(
      insertSub.run(
        dsExamId,
        studentIds[stu.sid],
        docId,
        stu.name,
        stu.sid,
        stu.approved ? "Completed" : "Flagged",
        stu.approved ? "Teacher Approved" : "Needs Manual Review",
        stu.total,
        stu.approved ? stu.total : null,
        stu.overallFeedback,
        stu.approved ? teacherId : null,
        stu.approved ? "2026-10-16T11:30:00.000Z" : null
      ).lastInsertRowid
    );

    for (const a of stu.answers) {
      const rubrics = db
        .prepare("SELECT criterion_name, max_marks FROM marking_rubrics WHERE question_id = ? ORDER BY sort_order")
        .all(a.qId) as { criterion_name: string; max_marks: number }[];
      let remaining = a.marks;
      const rubricScores = rubrics.map((r) => {
        const take = Math.min(r.max_marks, remaining);
        remaining = Math.max(0, remaining - take);
        return { criterionName: r.criterion_name, maxMarks: r.max_marks, awardedMarks: take };
      });

      insertQE.run(
        subId,
        a.qId,
        a.ans,
        a.page,
        a.status === "Extraction Uncertain" ? "Uncertain" : "Extracted",
        a.marks,
        stu.approved ? a.marks : null,
        JSON.stringify(rubricScores),
        JSON.stringify(a.ok),
        JSON.stringify(a.miss),
        JSON.stringify([]),
        a.fb,
        stu.approved ? a.fb : "",
        a.method,
        a.status,
        a.status === "Extraction Uncertain" || a.status === "Rubric Match Uncertain" ? 1 : 0,
        stu.approved ? teacherId : null
      );
    }
  }

  // =========================================================================
  // EXAM 2: DBMS Quiz 02 (Published — Ready for Student Review & Recheck!)
  // =========================================================================
  const dbmsKeyDocId = saveGeneratedPdf(db, {
    originalName: "DEMO_Answer_Key_CSE321_Quiz02.pdf",
    uploadedBy: teacherId,
    docKind: "answer_key",
    pages: [
      {
        header: "Stamford University Bangladesh — Official Answer Key (DEMO DATA)",
        subheader: "Dept. of CSE · Course: CSE 321 (DBMS) · Quiz 02 · Total: 20",
        lines: [
          "1. Which normal form eliminates transitive dependency? Answer: 3NF",
          "2. A foreign key in a relational table can contain NULL values unless constrained. Answer: True",
          "3. Given a table with 12 rows and 4 columns, what is its degree? Answer: 4",
          "4. Explain ACID properties in database transactions. Answer: Atomicity, Consistency, Isolation, Durability.",
        ],
      },
    ],
  });

  const dbmsExamId = Number(
    db
      .prepare(
        `INSERT INTO examinations (course_id, title, exam_date, total_marks, pass_threshold, total_questions, status, answer_key_verified, answer_key_file_id, published_at, created_by)
         VALUES (?, 'DBMS Quiz 02 [DEMO]', '2026-10-08', 20, 40, 4, 'Published', 1, ?, '2026-10-10T10:15:00.000Z', ?)`
      )
      .run(dbmsCourseId, dbmsKeyDocId, teacherId).lastInsertRowid
  );

  const dbQ1 = Number(
    insertQ.run(
      dbmsExamId,
      1,
      "Which normal form specifically eliminates transitive functional dependencies of non-key attributes?",
      "MCQ",
      5,
      "3NF",
      JSON.stringify(["Third Normal Form", "3rd Normal Form"]),
      0,
      "Database Normalization",
      1
    ).lastInsertRowid
  );
  insertRubric.run(dbQ1, "Correct Normal Form", 5, 0);

  const dbQ2 = Number(
    insertQ.run(
      dbmsExamId,
      2,
      "True or False: A foreign key column may contain NULL values unless declared NOT NULL.",
      "True/False",
      5,
      "True",
      JSON.stringify(["T", "Yes"]),
      0,
      "Relational Constraints",
      1
    ).lastInsertRowid
  );
  insertRubric.run(dbQ2, "Constraint Rule Accuracy", 5, 0);

  const dbQ3 = Number(
    insertQ.run(
      dbmsExamId,
      3,
      "A relation R has 12 tuples and 4 attributes. What is the degree of relation R?",
      "Numerical",
      5,
      "4",
      JSON.stringify(["4 attributes"]),
      0,
      "Relational Model",
      1
    ).lastInsertRowid
  );
  insertRubric.run(dbQ3, "Degree vs Cardinality Distinction", 5, 0);

  const dbQ4 = Number(
    insertQ.run(
      dbmsExamId,
      4,
      "Briefly explain the four ACID properties of a database transaction.",
      "Short Answer",
      5,
      "Atomicity (all-or-nothing), Consistency (valid state transitions), Isolation (concurrent transactions do not interfere), Durability (committed changes persist after crashes).",
      JSON.stringify(["Atomicity, Consistency, Isolation, Durability"]),
      0,
      "Transaction Management",
      2
    ).lastInsertRowid
  );
  insertRubric.run(dbQ4, "Atomicity & Consistency", 2.5, 0);
  insertRubric.run(dbQ4, "Isolation & Durability", 2.5, 1);

  const dbmsStudentScores = [
    {
      sid: "CSE22001",
      name: "Arif Hasan",
      total: 17,
      overall: "Very good understanding of normalization and relational constraints. Review Isolation vs Durability details in Q4.",
      answers: [
        { qId: dbQ1, ans: "3NF", marks: 5, page: 1, method: "Deterministic-MCQ", ok: ["Correctly identified 3NF."], miss: [], fb: "Exact match." },
        { qId: dbQ2, ans: "True", marks: 5, page: 1, method: "Deterministic-TF", ok: ["Correctly identified True."], miss: [], fb: "Correct. NULL represents unknown/unassigned relationship." },
        { qId: dbQ3, ans: "4", marks: 5, page: 1, method: "Deterministic-Numerical", ok: ["Degree equals number of attributes (4)."], miss: [], fb: "Correct." },
        { qId: dbQ4, ans: "Atomicity means all or nothing. Consistency preserves rules. Isolation separates transactions.", marks: 2, page: 2, method: "Demo-Preloaded", ok: ["Explained Atomicity and Consistency clearly.", "Mentioned Isolation."], miss: ["Did not explain Durability (persistence after system crash)."], fb: "Include Durability and clarify concurrent execution for Isolation." },
      ],
    },
    {
      sid: "CSE22002",
      name: "Nusrat Jahan",
      total: 15,
      overall: "Good performance; review degree vs cardinality definition on Q3.",
      answers: [
        { qId: dbQ1, ans: "3NF", marks: 5, page: 1, method: "Deterministic-MCQ", ok: ["Correct 3NF."], miss: [], fb: "Correct." },
        { qId: dbQ2, ans: "True", marks: 5, page: 1, method: "Deterministic-TF", ok: ["Correct True."], miss: [], fb: "Correct." },
        { qId: dbQ3, ans: "12", marks: 0, page: 1, method: "Deterministic-Numerical", ok: [], miss: ["12 is the cardinality (tuples); degree is the number of attributes (4)."], fb: "Confused degree with cardinality." },
        { qId: dbQ4, ans: "Atomicity, Consistency, Isolation, Durability with all-or-nothing, valid constraints, concurrency safety, and crash recovery.", marks: 5, page: 2, method: "Demo-Preloaded", ok: ["All four ACID properties accurately explained."], miss: [], fb: "Full marks." },
      ],
    },
    {
      sid: "CSE22003",
      name: "Tanvir Ahmed",
      total: 18,
      overall: "Strong quiz result across all topics.",
      answers: [
        { qId: dbQ1, ans: "3NF", marks: 5, page: 1, method: "Deterministic-MCQ", ok: ["Correct."], miss: [], fb: "Correct." },
        { qId: dbQ2, ans: "True", marks: 5, page: 1, method: "Deterministic-TF", ok: ["Correct."], miss: [], fb: "Correct." },
        { qId: dbQ3, ans: "4", marks: 5, page: 1, method: "Deterministic-Numerical", ok: ["Correct."], miss: [], fb: "Correct." },
        { qId: dbQ4, ans: "Atomicity (all or nothing), Consistency (valid states), Isolation (independent execution), Durability (saved permanently).", marks: 3, page: 2, method: "Demo-Preloaded", ok: ["Listed all four ACID properties."], miss: ["Provide brief explanation of crash persistence for Durability."], fb: "Good summary." },
      ],
    },
  ];

  let nusratDbmsSubId = 0;
  for (const stu of dbmsStudentScores) {
    const docId = saveGeneratedPdf(db, {
      originalName: `${stu.sid}_CSE321_Quiz02_DEMO.pdf`,
      uploadedBy: teacherId,
      docKind: "student_sheet",
      pages: [
        {
          header: "Stamford University Bangladesh — Quiz Script (DEMO)",
          subheader: `Student: ${stu.name} (${stu.sid}) · Course: CSE 321 · DBMS Quiz 02`,
          lines: [
            `1. ${stu.answers[0].ans}`,
            `2. ${stu.answers[1].ans}`,
            `3. ${stu.answers[2].ans}`,
          ],
        },
        {
          header: "Stamford University Bangladesh — Quiz Script (Page 2)",
          subheader: `Student: ${stu.name} (${stu.sid}) · CSE 321`,
          lines: [`4. ${stu.answers[3].ans}`],
        },
      ],
    });

    const subId = Number(
      insertSub.run(
        dbmsExamId,
        studentIds[stu.sid],
        docId,
        stu.name,
        stu.sid,
        "Completed",
        "Teacher Approved",
        stu.total,
        stu.total,
        stu.overall,
        teacherId,
        "2026-10-10T10:10:00.000Z"
      ).lastInsertRowid
    );
    if (stu.sid === "CSE22002") nusratDbmsSubId = subId;

    for (const a of stu.answers) {
      const rubrics = db
        .prepare("SELECT criterion_name, max_marks FROM marking_rubrics WHERE question_id = ? ORDER BY sort_order")
        .all(a.qId) as { criterion_name: string; max_marks: number }[];
      let remaining = a.marks;
      const rubricScores = rubrics.map((r) => {
        const take = Math.min(r.max_marks, remaining);
        remaining = Math.max(0, remaining - take);
        return { criterionName: r.criterion_name, maxMarks: r.max_marks, awardedMarks: take };
      });

      insertQE.run(
        subId,
        a.qId,
        a.ans,
        a.page,
        "Extracted",
        a.marks,
        a.marks,
        JSON.stringify(rubricScores),
        JSON.stringify(a.ok),
        JSON.stringify(a.miss),
        JSON.stringify([]),
        a.fb,
        a.fb,
        a.method,
        "Teacher Approved",
        0,
        teacherId
      );
    }
  }

  // =========================================================================
  // EXAM 3: Algorithms Final Exam (Awaiting Answer Key — Pending Work demo)
  // =========================================================================
  db.prepare(
    `INSERT INTO examinations (course_id, title, exam_date, total_marks, pass_threshold, total_questions, status, answer_key_verified, created_by)
     VALUES (?, 'Algorithms Final Exam [DEMO]', '2026-10-28', 50, 40, 0, 'Awaiting Answer Key', 0, ?)`
  ).run(algoCourseId, teacherId);

  // =========================================================================
  // EXAM 4: OOP Midterm 2026 (Published — additional published history)
  // =========================================================================
  const oopExamId = Number(
    db
      .prepare(
        `INSERT INTO examinations (course_id, title, exam_date, total_marks, pass_threshold, total_questions, status, answer_key_verified, published_at, created_by)
         VALUES (?, 'OOP Midterm 2026 [DEMO]', '2026-04-15', 40, 40, 2, 'Published', 1, '2026-04-20T09:00:00.000Z', ?)`
      )
      .run(oopCourseId, teacherId).lastInsertRowid
  );
  const oopQ1 = Number(
    insertQ.run(
      oopExamId,
      1,
      "What is method overriding in Object-Oriented Programming?",
      "Short Answer",
      20,
      "Redefining a superclass method in a subclass with the same signature to achieve runtime polymorphism.",
      JSON.stringify(["Runtime polymorphism subclass redefinition"]),
      0,
      "Polymorphism",
      1
    ).lastInsertRowid
  );
  insertRubric.run(oopQ1, "Subclass Redefinition & Same Signature", 12, 0);
  insertRubric.run(oopQ1, "Runtime Polymorphism Connection", 8, 1);

  const oopQ2 = Number(
    insertQ.run(
      oopExamId,
      2,
      "True or False: An abstract class can contain both abstract and concrete methods.",
      "True/False",
      20,
      "True",
      JSON.stringify(["T"]),
      0,
      "Abstraction",
      1
    ).lastInsertRowid
  );
  insertRubric.run(oopQ2, "Correct Boolean Answer", 20, 0);

  const arifOopDoc = saveGeneratedPdf(db, {
    originalName: "CSE22001_CSE211_Midterm_DEMO.pdf",
    uploadedBy: teacherId,
    docKind: "student_sheet",
    pages: [
      {
        header: "Stamford University Bangladesh — OOP Midterm (DEMO)",
        subheader: "Student: Arif Hasan (CSE22001) · Course: CSE 211",
        lines: [
          "1. Method overriding allows a subclass to provide a specific implementation of a method defined in its parent class using the same signature for runtime polymorphism.",
          "2. True",
        ],
      },
    ],
  });
  const arifOopSubId = Number(
    insertSub.run(
      oopExamId,
      studentIds["CSE22001"],
      arifOopDoc,
      "Arif Hasan",
      "CSE22001",
      "Completed",
      "Teacher Approved",
      38,
      38,
      "Excellent conceptual clarity on OOP fundamentals.",
      teacherId,
      "2026-04-20T08:50:00.000Z"
    ).lastInsertRowid
  );
  insertQE.run(
    arifOopSubId,
    oopQ1,
    "Method overriding allows a subclass to provide a specific implementation of a method defined in its parent class using the same signature for runtime polymorphism.",
    1,
    "Extracted",
    18,
    18,
    JSON.stringify([
      { criterionName: "Subclass Redefinition & Same Signature", maxMarks: 12, awardedMarks: 12 },
      { criterionName: "Runtime Polymorphism Connection", maxMarks: 8, awardedMarks: 6 },
    ]),
    JSON.stringify(["Correctly described subclass redefinition and signature match.", "Mentioned runtime polymorphism."]),
    JSON.stringify(["Add a brief dynamic dispatch example."]),
    JSON.stringify([]),
    "Strong explanation.",
    "Strong explanation; a short code snippet would make it 20/20.",
    "Demo-Preloaded",
    "Teacher Approved",
    0,
    teacherId
  );
  insertQE.run(
    arifOopSubId,
    oopQ2,
    "True",
    1,
    "Extracted",
    20,
    20,
    JSON.stringify([{ criterionName: "Correct Boolean Answer", maxMarks: 20, awardedMarks: 20 }]),
    JSON.stringify(["Correctly answered True."]),
    JSON.stringify([]),
    JSON.stringify([]),
    "Correct.",
    "Correct.",
    "Deterministic-TF",
    "Teacher Approved",
    0,
    teacherId
  );

  // Sample Recheck Request from Nusrat Jahan on DBMS Quiz Q3
  db.prepare(
    `INSERT INTO recheck_requests (submission_id, question_id, student_id, exam_id, reason, student_comment, status, original_marks)
     VALUES (?, ?, ?, ?, 'I need clarification on the feedback', 'I counted 12 rows in the table and want to verify whether degree refers to columns or rows.', 'Submitted', 0)`
  ).run(nusratDbmsSubId, dbQ3, studentIds["CSE22002"], dbmsExamId);

  // Seed initial notifications
  createNotification(db, {
    userId: teacherId,
    title: "Scripts awaiting manual review",
    message: "2 scripts in Data Structures Midterm 2026 (Tanvir Ahmed, Fahim Rahman) require teacher review.",
    type: "warning",
    linkScreen: "review",
    linkEntityId: dsExamId,
  });
  createNotification(db, {
    userId: teacherId,
    title: "New recheck request received",
    message: "Nusrat Jahan (CSE22002) submitted a recheck request for DBMS Quiz 02 · Q3.",
    type: "info",
    linkScreen: "teacherRechecks",
    linkEntityId: dbmsExamId,
  });
  createNotification(db, {
    userId: studentIds["CSE22001"],
    title: "Results published: DBMS Quiz 02",
    message: "Dr. Mahmud Rahman published your DBMS Quiz 02 result (17/20) and question-by-question feedback.",
    type: "success",
    linkScreen: "studentResult",
    linkEntityId: dbmsExamId,
  });

  // Seed Audit History
  logAudit(db, {
    entityType: "exam",
    entityId: dsExamId,
    action: "Answer key verified",
    actorId: teacherId,
    actorName: "Dr. Mahmud Rahman",
    details: { title: "Data Structures Midterm 2026 [DEMO]" },
  });
  logAudit(db, {
    entityType: "exam",
    entityId: dbmsExamId,
    action: "Results published",
    actorId: teacherId,
    actorName: "Dr. Mahmud Rahman",
    details: { title: "DBMS Quiz 02 [DEMO]", studentCount: 3 },
  });
}

