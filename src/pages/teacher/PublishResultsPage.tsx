import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
  Metric,
  Modal,
  PageHead,
  statusTone,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { apiRequest, downloadProtectedFile } from "../../lib/api";
import type { Examination, NavState, Screen, Submission } from "../../types";

export function PublishResultsPage({
  mode = "results",
  examId,
  go,
  notify,
}: {
  mode?: "results" | "publish";
  examId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const { refreshNotifications } = useAuth();
  const [exams, setExams] = useState<Examination[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | undefined>(examId);
  const [exam, setExam] = useState<Examination | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [justPublished, setJustPublished] = useState(false);

  const load = async (targetId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const exRes = await apiRequest<{ exams: Examination[] }>("/api/exams");
      setExams(exRes.exams);
      const idToUse =
        targetId ||
        exRes.exams.find((e) => e.status === "Ready to Publish")?.id ||
        exRes.exams.find((e) => (e.submission_count || 0) > 0)?.id ||
        exRes.exams[0]?.id;

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
      setSubmissions(subsRes.submissions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load examination results.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setJustPublished(false);
    load(examId);
  }, [examId, mode]);

  const handlePublish = async () => {
    if (!exam) return;
    setPublishing(true);
    try {
      const res = await apiRequest<{ exam: Examination }>(`/api/exams/${exam.id}/publish`, {
        method: "POST",
      });
      setExam({ ...exam, ...res.exam });
      setConfirmOpen(false);
      setJustPublished(true);
      await refreshNotifications();
      notify("Examination results published to students");
    } catch (err) {
      notify(err instanceof Error ? err.message : "Publish failed.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const approvedCount = submissions.filter((s) => s.review_status === "Teacher Approved").length;
  const pendingCount = submissions.length - approvedCount;

  const filtered = submissions.filter((s) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (s.student_name || s.detected_student_name || "").toLowerCase().includes(q) ||
      (s.student_id_number || s.detected_student_id || "").toLowerCase().includes(q);
    const matchesFilter =
      statusFilter === "All"
        ? true
        : statusFilter === "Approved"
          ? s.review_status === "Teacher Approved"
          : s.review_status !== "Teacher Approved";
    return matchesSearch && matchesFilter;
  });

  if (justPublished && exam) {
    return (
      <Shell screen="publish" go={go} title="Results Published" breadcrumb="Results / Complete">
        <div className="success-page card">
          <span>
            <Icon name="check" size={32} />
          </span>
          <Badge tone="green">PUBLICATION COMPLETE</Badge>
          <h1>Results Published Successfully</h1>
          <p>
            All {submissions.length} student(s) can now view their verified scores and
            teacher-approved feedback in their portal.
          </p>
          <div className="published-meta">
            <div>
              <small>Examination</small>
              <strong>{exam.title}</strong>
            </div>
            <div>
              <small>Published</small>
              <strong>{exam.published_at || new Date().toLocaleString()}</strong>
            </div>
          </div>
          <div>
            <Button
              kind="secondary"
              onClick={() => {
                setJustPublished(false);
                go("results", { examId: exam.id });
              }}
            >
              View Published Results
            </Button>
            <Button onClick={() => go("teacher")}>Back to Dashboard</Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      screen={mode}
      go={go}
      title={mode === "publish" ? "Publish Results" : "Examination Results"}
      breadcrumb={exam ? `${exam.course_code} / Results` : "Results"}
    >
      <PageHead
        title={mode === "publish" ? "Publish Examination Results" : "Examination Results"}
        subtitle={exam ? `${exam.course_code} · ${exam.exam_date}` : undefined}
        action={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {exams.length > 0 && (
              <select
                value={selectedExamId || ""}
                onChange={(e) => load(Number(e.target.value))}
                aria-label="Select examination"
                style={{ minWidth: 250 }}
              >
                {exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.course_code} — {ex.title} ({ex.status})
                  </option>
                ))}
              </select>
            )}
            {exam && submissions.length > 0 && (
              <>
                <Button
                  kind="secondary"
                  icon="download"
                  onClick={async () => {
                    try {
                      await downloadProtectedFile(
                        `/api/exams/${exam.id}/export/csv?type=results`,
                        "results.csv"
                      );
                      notify("CSV Result Sheet downloaded");
                    } catch (err) {
                      notify(err instanceof Error ? err.message : "Export failed.", "error");
                    }
                  }}
                >
                  Export CSV
                </Button>
                <Button
                  kind="secondary"
                  icon="download"
                  onClick={async () => {
                    try {
                      await downloadProtectedFile(
                        `/api/exams/${exam.id}/export/pdf`,
                        "Result_Sheet.pdf"
                      );
                      notify("PDF Result Sheet downloaded");
                    } catch (err) {
                      notify(err instanceof Error ? err.message : "Export failed.", "error");
                    }
                  }}
                >
                  Export PDF
                </Button>
              </>
            )}
          </div>
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => load(selectedExamId)} />
      ) : !exam ? (
        <EmptyState
          icon="chart"
          title="No examinations found"
          description="Create an examination and evaluate scripts to view results."
        />
      ) : mode === "publish" ? (
        <div className="publish-layout">
          <section className="card publish-summary">
            <div className="summary-head">
              <span className="metric-icon">
                <Icon name="file" />
              </span>
              <div>
                <small>EXAMINATION</small>
                <h2>{exam.title}</h2>
                <p>
                  {exam.course_code} · {exam.semester} · {exam.exam_date}
                </p>
              </div>
              <Badge tone={statusTone(exam.status)}>{exam.status}</Badge>
            </div>

            <div className="summary-stats">
              <div>
                <small>Students</small>
                <strong>{submissions.length}</strong>
              </div>
              <div>
                <small>Approved</small>
                <strong>{approvedCount}</strong>
              </div>
              <div>
                <small>Pending review</small>
                <strong>{pendingCount}</strong>
              </div>
              <div>
                <small>Total marks</small>
                <strong>{exam.total_marks}</strong>
              </div>
            </div>

            <h3>Student Evaluations ({submissions.length})</h3>
            {submissions.map((s) => (
              <div className="approved-row" key={s.id}>
                <span className="initial">{s.avatar_initials || "ST"}</span>
                <div>
                  <strong>{s.student_name || s.detected_student_name}</strong>
                  <small>{s.student_id_number || s.detected_student_id}</small>
                </div>
                <strong>
                  {s.total_approved_marks ?? s.total_suggested_marks} / {exam.total_marks}
                </strong>
                <Badge tone={statusTone(s.review_status)}>{s.review_status}</Badge>
              </div>
            ))}
          </section>

          <aside className="card publish-check">
            <span className={pendingCount === 0 ? "large-check" : "large-warn"}>
              <Icon name={pendingCount === 0 ? "check" : "alert"} />
            </span>
            <h3>
              {exam.status === "Published"
                ? "Results Published"
                : pendingCount === 0
                  ? "Ready to Publish"
                  : "Reviews Incomplete"}
            </h3>
            <p>
              {exam.status === "Published"
                ? "Students can view their scores and teacher-approved feedback."
                : pendingCount === 0
                  ? "Every script has been verified by a teacher. Publishing makes results and feedback visible to each student."
                  : `${pendingCount} script(s) still need teacher approval before publishing.`}
            </p>

            <div className="privacy-list">
              <p>
                <Icon name="check" size={14} /> Students see only their own records
              </p>
              <p>
                <Icon name="check" size={14} /> Only teacher-approved scores &amp; feedback shown
              </p>
              <p>
                <Icon name="check" size={14} /> Publication is logged for audit
              </p>
            </div>

            {exam.status === "Published" ? (
              <Button kind="secondary" onClick={() => go("results", { examId: exam.id })}>
                View Results Table
              </Button>
            ) : pendingCount > 0 ? (
              <Button onClick={() => go("evaluations", { examId: exam.id })}>
                Review Remaining Scripts →
              </Button>
            ) : (
              <Button disabled={submissions.length === 0} onClick={() => setConfirmOpen(true)}>
                Publish Results
              </Button>
            )}
            <small>Post-publication corrections require an audited reason.</small>
          </aside>
        </div>
      ) : (
        <>
          <div className="metrics four">
            <Metric label="Total Students" value={submissions.length} icon="users" />
            <Metric label="Teacher Approved" value={approvedCount} icon="check" />
            <Metric label="Pending Review" value={pendingCount} icon="alert" />
            <Metric label="Exam Status" value={exam.status} icon="file" />
          </div>

          <section className="card section-card results-table">
            <div className="table-toolbar">
              <div className="search">
                <Icon name="search" size={16} />
                <input
                  placeholder="Search by student name or ID…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                aria-label="Filter results"
              >
                <option value="All">All statuses</option>
                <option value="Approved">Teacher Approved</option>
                <option value="Pending">Needs Review</option>
              </select>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon="file"
                title="No results recorded yet"
                description="Upload and evaluate student scripts for this examination."
                action={
                  <Button onClick={() => go("sheets", { examId: exam.id })}>
                    Upload Student Sheets
                  </Button>
                }
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Student ID</th>
                      <th>Suggested</th>
                      <th>Approved Score</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="person">
                            <span className="initial">{s.avatar_initials || "ST"}</span>
                            <strong>{s.student_name || s.detected_student_name}</strong>
                          </div>
                        </td>
                        <td>{s.student_id_number || s.detected_student_id}</td>
                        <td>
                          {s.total_suggested_marks} / {exam.total_marks}
                        </td>
                        <td>
                          <strong>
                            {s.total_approved_marks !== null
                              ? `${s.total_approved_marks} / ${exam.total_marks}`
                              : "Pending"}
                          </strong>
                        </td>
                        <td>
                          <Badge tone={statusTone(s.review_status)}>{s.review_status}</Badge>
                        </td>
                        <td>
                          <div className="row-actions">
                            <Button
                              kind="secondary"
                              onClick={() =>
                                go("review", { examId: exam.id, submissionId: s.id })
                              }
                            >
                              {exam.status === "Published" ? "Inspect / Correct" : "Open Evaluation"}
                            </Button>
                            <button
                              className="link"
                              onClick={() =>
                                downloadProtectedFile(
                                  `/api/submissions/${s.id}/feedback-pdf`,
                                  `${s.student_id_number || "Student"}_Feedback.pdf`
                                )
                              }
                            >
                              PDF
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {submissions.length > 0 && exam.status !== "Published" && (
              <div className={`publish-bar ${pendingCount === 0 ? "ready" : ""}`}>
                <div>
                  <Icon name={pendingCount === 0 ? "check" : "alert"} />
                  <p>
                    <strong>
                      {pendingCount === 0
                        ? "All evaluations approved — ready to publish"
                        : `${pendingCount} evaluation(s) require teacher review`}
                    </strong>
                    <span>
                      {pendingCount === 0
                        ? "Publish results so students can access their scores and feedback."
                        : "Publishing becomes available once every script is teacher-approved."}
                    </span>
                  </p>
                </div>
                <Button
                  disabled={pendingCount > 0}
                  onClick={() => go("publish", { examId: exam.id })}
                >
                  Publish Results
                </Button>
              </div>
            )}
          </section>
        </>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm Result Publication"
      >
        <p style={{ fontSize: 13, color: "#475569", marginBottom: 14 }}>
          Publish verified results for <strong>{exam?.title}</strong>? All {submissions.length}{" "}
          student(s) will be notified and granted access to their own scores and feedback.
        </p>
        <div className="modal-footer">
          <Button kind="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button disabled={publishing} onClick={handlePublish}>
            {publishing ? "Publishing…" : "Confirm & Publish"}
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}

