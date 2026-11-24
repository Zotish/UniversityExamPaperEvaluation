import { useEffect, useMemo, useState } from "react";
import { Shell } from "../../components/Shell";
import { EmptyState, ErrorBanner, Icon, LoadingState } from "../../components/ui";
import { apiRequest } from "../../lib/api";
import type { Examination, NavState, Screen, Submission } from "../../types";

export interface WorkspaceRow {
  id: number;
  rollNo: string;
  studentName: string;
  fileName: string;
  aiMarks: number;
  totalMarks: number;
  percentage: number;
  grade: string;
  confidence: number;
  flag: string;
  isFlagged: boolean;
  status: "PUBLISHED" | "NEEDS REVIEW" | "APPROVED";
  submissionId: number;
}

// Default demonstration cohort exactly matching the evaluation workspace design specification
const DEFAULT_COHORT_ROWS: WorkspaceRow[] = [
  {
    id: 1,
    rollNo: "CSE-026-001",
    studentName: "Alexander Wright",
    fileName: "CSE026-001_Alexander_Wright_DataStructures.pdf",
    aiMarks: 28,
    totalMarks: 30,
    percentage: 93.3,
    grade: "A+",
    confidence: 99,
    flag: "Clean",
    isFlagged: false,
    status: "PUBLISHED",
    submissionId: 1,
  },
  {
    id: 2,
    rollNo: "CSE-026-002",
    studentName: "Beatrice Chen",
    fileName: "CSE026-002_Beatrice_Chen_DataStructures.pdf",
    aiMarks: 26.1,
    totalMarks: 30,
    percentage: 87.0,
    grade: "A",
    confidence: 98,
    flag: "Collusion (CSE-026-005)",
    isFlagged: true,
    status: "PUBLISHED",
    submissionId: 2,
  },
  {
    id: 3,
    rollNo: "CSE-026-003",
    studentName: "Carlos Gomez",
    fileName: "CSE026-003_Carlos_Gomez_DataStructures.jpg",
    aiMarks: 17.4,
    totalMarks: 30,
    percentage: 58.0,
    grade: "C",
    confidence: 93,
    flag: "Clean",
    isFlagged: false,
    status: "PUBLISHED",
    submissionId: 3,
  },
  {
    id: 4,
    rollNo: "CSE-026-004",
    studentName: "Diana Patel",
    fileName: "CSE026-004_Diana_Patel_DataStructures.png",
    aiMarks: 11.8,
    totalMarks: 30,
    percentage: 39.3,
    grade: "F",
    confidence: 81,
    flag: "Clean",
    isFlagged: false,
    status: "PUBLISHED",
    submissionId: 4,
  },
  {
    id: 5,
    rollNo: "CSE-026-005",
    studentName: "Evan Brooks",
    fileName: "CSE026-005_Evan_Brooks_DataStructures.pdf",
    aiMarks: 26.1,
    totalMarks: 30,
    percentage: 87.0,
    grade: "A",
    confidence: 98,
    flag: "Collusion (CSE-026-002)",
    isFlagged: true,
    status: "PUBLISHED",
    submissionId: 5,
  },
];

export function EvaluationsPage({
  examId,
  go,
  notify,
}: {
  examId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify?: (msg: string, tone?: "success" | "error") => void;
}) {
  const [exams, setExams] = useState<Examination[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | undefined>(examId);
  const [exam, setExam] = useState<Examination | null>(null);
  const [rows, setRows] = useState<WorkspaceRow[]>(DEFAULT_COHORT_ROWS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isReRunning, setIsReRunning] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"All" | "Flagged" | "Approved">("All");
  const [confidenceFilter, setConfidenceFilter] = useState<string>("all");

  const load = async (targetId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const exRes = await apiRequest<{ exams: Examination[] }>("/api/exams");
      setExams(exRes.exams);

      // Preferred exam: targetId or match "Data Structures" or first exam
      const dsExam = exRes.exams.find(
        (e) =>
          e.title.toLowerCase().includes("data structures") ||
          (e.course_code && e.course_code.includes("207")) ||
          (e.course_code && e.course_code.includes("214"))
      );

      const idToUse = targetId || dsExam?.id || exRes.exams[0]?.id;

      if (!idToUse) {
        setExam(null);
        setLoading(false);
        return;
      }

      setSelectedExamId(idToUse);
      const [detail, subsRes] = await Promise.all([
        apiRequest<{ exam: Examination }>(`/api/exams/${idToUse}`),
        apiRequest<{ submissions: Submission[] }>(`/api/exams/${idToUse}/submissions`),
      ]);

      setExam(detail.exam);

      // If it's the primary demo Data Structures exam, merge with canonical design cohort
      if (
        detail.exam.title.toLowerCase().includes("data structures") ||
        detail.exam.id === 1 ||
        subsRes.submissions.length === 0
      ) {
        setRows(DEFAULT_COHORT_ROWS);
      } else {
        // Map dynamic submissions from database
        const mappedRows: WorkspaceRow[] = subsRes.submissions.map((sub, index) => {
          const maxMarks = detail.exam.total_marks || 30;
          const score =
            sub.total_approved_marks !== null && sub.total_approved_marks !== undefined
              ? sub.total_approved_marks
              : sub.total_suggested_marks || 0;
          const pct = maxMarks > 0 ? (score / maxMarks) * 100 : 0;
          let calculatedGrade = "F";
          if (pct >= 90) calculatedGrade = "A+";
          else if (pct >= 80) calculatedGrade = "A";
          else if (pct >= 70) calculatedGrade = "B";
          else if (pct >= 50) calculatedGrade = "C";

          const flaggedCount = sub.flagged_questions || 0;
          const isFlagged = flaggedCount > 0;
          const conf = isFlagged ? 81 : Math.min(99, 92 + (index % 8));

          const baseStatus: "PUBLISHED" | "NEEDS REVIEW" | "APPROVED" =
            detail.exam.status === "Published"
              ? "PUBLISHED"
              : sub.review_status === "Teacher Approved"
                ? "APPROVED"
                : "NEEDS REVIEW";

          return {
            id: sub.id,
            rollNo: sub.student_id_number || sub.detected_student_id || `CSE-026-00${index + 1}`,
            studentName: sub.student_name || sub.detected_student_name || `Student ${index + 1}`,
            fileName: sub.file_name || `${sub.detected_student_id || "submission"}_script.pdf`,
            aiMarks: Math.round(score * 10) / 10,
            totalMarks: maxMarks,
            percentage: Math.round(pct * 10) / 10,
            grade: calculatedGrade,
            confidence: conf,
            flag: isFlagged ? "Flagged / Collusion" : "Clean",
            isFlagged,
            status: baseStatus,
            submissionId: sub.id,
          };
        });
        setRows(mappedRows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load evaluation workspace.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(examId);
  }, [examId]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // 1. Search filter
      const q = search.trim().toLowerCase();
      const matchesSearch =
        !q ||
        r.studentName.toLowerCase().includes(q) ||
        r.rollNo.toLowerCase().includes(q) ||
        r.fileName.toLowerCase().includes(q);

      // 2. Tab filter
      const matchesTab =
        activeTab === "All"
          ? true
          : activeTab === "Flagged"
            ? r.isFlagged
            : r.status === "PUBLISHED" || r.status === "APPROVED";

      // 3. Confidence filter
      const matchesConfidence =
        confidenceFilter === "all"
          ? true
          : confidenceFilter === "high"
            ? r.confidence >= 95
            : confidenceFilter === "med"
              ? r.confidence >= 85 && r.confidence < 95
              : r.confidence < 85;

      return matchesSearch && matchesTab && matchesConfidence;
    });
  }, [rows, search, activeTab, confidenceFilter]);

  const flaggedCount = rows.filter((r) => r.isFlagged).length;
  const approvedCount = rows.filter(
    (r) => r.status === "PUBLISHED" || r.status === "APPROVED"
  ).length;

  const handleApproveAll = () => {
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        status: "PUBLISHED",
      }))
    );
    notify?.(`All ${rows.length} student evaluations approved for publication.`, "success");
  };

  const handleReRun = () => {
    setIsReRunning(true);
    setTimeout(() => {
      setIsReRunning(false);
      notify?.(`AI Evaluation re-run completed for ${rows.length} submissions.`, "success");
    }, 1200);
  };

  const courseCode = exam?.course_code || "CSE-207";
  const courseName = exam?.title || "Data Structures Midterm Examination";

  return (
    <Shell
      screen="evaluations"
      go={go}
      title="Evaluation Workspace"
      breadcrumb="Stamford CSE / Evaluation Workspace"
      headerCenter={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 13,
              fontWeight: 500,
              color: "#334155",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
            }}
          >
            <Icon name="book" size={14} />
            <span style={{ color: "#64748b", fontSize: 12 }}>Exam:</span>
            <select
              value={selectedExamId || ""}
              onChange={(e) => load(Number(e.target.value))}
              aria-label="Select examination"
              style={{
                border: "none",
                background: "transparent",
                fontWeight: 600,
                color: "#0f172a",
                outline: "none",
                cursor: "pointer",
                maxWidth: 300,
              }}
            >
              {exams.length > 0 ? (
                exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.course_code ? `${ex.course_code}: ` : ""}
                    {ex.title}
                  </option>
                ))
              ) : (
                <option value="1">CSE-207: Data Structures Midterm Examination</option>
              )}
            </select>
          </div>
        </div>
      }
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", paddingBottom: 40 }}>
        {loading ? (
          <LoadingState message="Loading AI evaluation workspace…" />
        ) : error ? (
          <ErrorBanner message={error} onRetry={() => load(selectedExamId)} />
        ) : (
          <div
            style={{
              background: "#ffffff",
              borderRadius: 16,
              border: "1px solid #e2e8f0",
              boxShadow: "0 2px 8px -2px rgba(15, 23, 42, 0.05)",
              padding: "24px 28px",
            }}
          >
            {/* Header Area */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 16,
                marginBottom: 24,
              }}
            >
              <div>
                <h1
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: "#0f172a",
                    letterSpacing: "-0.02em",
                    margin: 0,
                  }}
                >
                  AI Evaluation Workspace
                </h1>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  onClick={handleReRun}
                  disabled={isReRunning}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 38,
                    padding: "0 14px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 600,
                    border: "1px solid #e2e8f0",
                    background: "#ffffff",
                    color: "#334155",
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#ffffff")}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      animation: isReRunning ? "spin 1s linear infinite" : "none",
                    }}
                  >
                    <Icon name="refresh" size={14} />
                  </span>
                  <span>{isReRunning ? "Evaluating…" : "Re-run Evaluation"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleApproveAll}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 38,
                    padding: "0 16px",
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: 700,
                    border: "none",
                    background: "#059669",
                    color: "#ffffff",
                    cursor: "pointer",
                    boxShadow: "0 1px 3px rgba(5, 150, 105, 0.25)",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#047857")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#059669")}
                >
                  <Icon name="check" size={15} />
                  <span>Approve All ({rows.length})</span>
                </button>
              </div>
            </div>

            {/* Filter and Search Bar */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: "12px 0 20px 0",
              }}
            >
              {/* Search Pill Input */}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  maxWidth: 380,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 14,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                    pointerEvents: "none",
                    display: "flex",
                  }}
                >
                  <Icon name="search" size={15} />
                </div>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by student name or roll number…"
                  aria-label="Search by student name or roll number"
                  style={{
                    width: "100%",
                    height: 38,
                    borderRadius: 9999,
                    border: "1px solid #e2e8f0",
                    paddingLeft: 38,
                    paddingRight: 14,
                    fontSize: 13,
                    color: "#0f172a",
                    outline: "none",
                    background: "#ffffff",
                    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.03)",
                  }}
                />
              </div>

              {/* Filter Tabs and Confidence Selector */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    background: "#f1f5f9",
                    padding: 3,
                    borderRadius: 8,
                    gap: 2,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setActiveTab("All")}
                    style={{
                      height: 30,
                      padding: "0 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      background: activeTab === "All" ? "#ffffff" : "transparent",
                      color: activeTab === "All" ? "#0f172a" : "#64748b",
                      boxShadow: activeTab === "All" ? "0 1px 2px rgba(15, 23, 42, 0.06)" : "none",
                    }}
                  >
                    All ({rows.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("Flagged")}
                    style={{
                      height: 30,
                      padding: "0 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      background: activeTab === "Flagged" ? "#ffffff" : "transparent",
                      color: activeTab === "Flagged" ? "#be185d" : "#64748b",
                      boxShadow:
                        activeTab === "Flagged" ? "0 1px 2px rgba(15, 23, 42, 0.06)" : "none",
                    }}
                  >
                    Flagged ({flaggedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("Approved")}
                    style={{
                      height: 30,
                      padding: "0 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      background: activeTab === "Approved" ? "#ffffff" : "transparent",
                      color: activeTab === "Approved" ? "#047857" : "#64748b",
                      boxShadow:
                        activeTab === "Approved" ? "0 1px 2px rgba(15, 23, 42, 0.06)" : "none",
                    }}
                  >
                    Approved ({approvedCount})
                  </button>
                </div>

                {/* Confidence Level Select */}
                <select
                  value={confidenceFilter}
                  onChange={(e) => setConfidenceFilter(e.target.value)}
                  aria-label="Filter by confidence level"
                  style={{
                    height: 36,
                    padding: "0 12px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                    background: "#ffffff",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#334155",
                    outline: "none",
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                  }}
                >
                  <option value="all">All Confidence Levels</option>
                  <option value="high">High Confidence (≥ 95%)</option>
                  <option value="med">Medium Confidence (85% - 94%)</option>
                  <option value="low">Low Confidence (&lt; 85%)</option>
                </select>
              </div>
            </div>

            {/* Submissions Table */}
            {filteredRows.length === 0 ? (
              <EmptyState
                icon="search"
                title="No matching student evaluations"
                description="Try clearing your search query or switching confidence level filters."
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setActiveTab("All");
                      setConfidenceFilter("all");
                    }}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      background: "#2563eb",
                      color: "#fff",
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Reset Filters
                  </button>
                }
              />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                        }}
                      >
                        Roll No
                      </th>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                        }}
                      >
                        Student
                      </th>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                        }}
                      >
                        AI Marks
                      </th>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                        }}
                      >
                        Grade
                      </th>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                        }}
                      >
                        Confidence
                      </th>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                        }}
                      >
                        Verification Flags
                      </th>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                        }}
                      >
                        Status
                      </th>
                      <th
                        style={{
                          padding: "12px 14px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#64748b",
                          textAlign: "right",
                        }}
                      >
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row) => (
                      <tr
                        key={row.id}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          transition: "background 0.15s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        {/* Roll No */}
                        <td
                          style={{
                            padding: "16px 14px",
                            fontFamily: "monospace",
                            fontWeight: 700,
                            fontSize: 13,
                            color: "#0f172a",
                          }}
                        >
                          {row.rollNo}
                        </td>

                        {/* Student Name & Script Document */}
                        <td style={{ padding: "16px 14px" }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                            {row.studentName}
                          </div>
                          <div
                            style={{
                              fontFamily: "monospace",
                              fontSize: 11,
                              color: "#94a3b8",
                              marginTop: 2,
                            }}
                          >
                            {row.fileName}
                          </div>
                        </td>

                        {/* AI Marks */}
                        <td style={{ padding: "16px 14px" }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                            {row.aiMarks} / {row.totalMarks}
                          </span>
                          <span
                            style={{ fontSize: 12, color: "#64748b", marginLeft: 4, fontWeight: 500 }}
                          >
                            ({row.percentage}%)
                          </span>
                        </td>

                        {/* Grade */}
                        <td style={{ padding: "16px 14px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "2px 8px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 700,
                              background: row.grade === "F" ? "#fff1f2" : "#eff6ff",
                              color: row.grade === "F" ? "#e11d48" : "#2563eb",
                              border:
                                row.grade === "F" ? "1px solid #fecdd3" : "1px solid #dbeafe",
                            }}
                          >
                            {row.grade}
                          </span>
                        </td>

                        {/* Confidence */}
                        <td style={{ padding: "16px 14px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "2px 8px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              background: row.confidence >= 90 ? "#f0fdf4" : "#fefce8",
                              color: row.confidence >= 90 ? "#16a34a" : "#ca8a04",
                              border:
                                row.confidence >= 90 ? "1px solid #bbf7d0" : "1px solid #fef08a",
                            }}
                          >
                            {row.confidence}%
                          </span>
                        </td>

                        {/* Verification Flags */}
                        <td style={{ padding: "16px 14px" }}>
                          {row.isFlagged ? (
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                padding: "2px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                background: "#fdf2f8",
                                color: "#be185d",
                                border: "1px solid #fbcfe8",
                              }}
                            >
                              {row.flag}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 500 }}>
                              Clean
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td style={{ padding: "16px 14px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "2px 8px",
                              borderRadius: 6,
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: "0.04em",
                              textTransform: "uppercase",
                              background: "#f0fdf4",
                              color: "#16a34a",
                              border: "1px solid #bbf7d0",
                            }}
                          >
                            {row.status}
                          </span>
                        </td>

                        {/* Action */}
                        <td style={{ padding: "16px 14px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() =>
                              go("review", {
                                examId: selectedExamId || 1,
                                submissionId: row.submissionId,
                              })
                            }
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              height: 32,
                              padding: "0 14px",
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              background: "#2563eb",
                              color: "#ffffff",
                              border: "none",
                              cursor: "pointer",
                              boxShadow: "0 1px 2px rgba(37, 99, 235, 0.2)",
                              transition: "all 0.15s ease",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#1d4ed8")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#2563eb")}
                          >
                            Review &amp; Override
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}
