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
  PageHead,
  statusTone,
} from "../../components/ui";
import { apiRequest } from "../../lib/api";
import type { Examination, NavState, Screen, Submission } from "../../types";

export function EvaluationsPage({
  examId,
  go,
}: {
  examId?: number;
  go: (s: Screen, state?: NavState) => void;
}) {
  const [exams, setExams] = useState<Examination[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number | undefined>(examId);
  const [exam, setExam] = useState<Examination | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");

  const load = async (targetId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const exRes = await apiRequest<{ exams: Examination[] }>("/api/exams");
      setExams(exRes.exams);

      const idToUse =
        targetId ||
        exRes.exams.find((e) => e.status === "Needs Review")?.id ||
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
      setError(err instanceof Error ? err.message : "Failed to load evaluations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(examId);
  }, [examId]);

  const filtered = submissions.filter((s) => {
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (s.student_name || s.detected_student_name || "").toLowerCase().includes(q) ||
      (s.student_id_number || s.detected_student_id || "").toLowerCase().includes(q);
    const matchesStatus =
      filter === "All"
        ? true
        : filter === "Needs Review"
          ? s.review_status !== "Teacher Approved"
          : s.review_status === "Teacher Approved";
    return matchesSearch && matchesStatus;
  });

  const approvedCount = submissions.filter((s) => s.review_status === "Teacher Approved").length;
  const needsReviewCount = submissions.length - approvedCount;

  return (
    <Shell
      screen="evaluations"
      go={go}
      title="Evaluations"
      breadcrumb={exam ? `${exam.course_code} / Evaluations` : "Evaluations"}
      searchPlaceholder="Search student…"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <PageHead
        title="Answer Sheet Evaluations"
        action={
          exams.length > 0 && (
            <select
              value={selectedExamId || ""}
              onChange={(e) => load(Number(e.target.value))}
              aria-label="Select examination"
              style={{ minWidth: 270 }}
            >
              {exams.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.course_code} — {ex.title} ({ex.status})
                </option>
              ))}
            </select>
          )
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => load(selectedExamId)} />
      ) : !exam ? (
        <EmptyState
          icon="clipboard"
          title="No examinations available"
          description="Create an examination and upload student scripts to start evaluating."
        />
      ) : (
        <>
          <div className="metrics four">
            <Metric label="Total Scripts" value={submissions.length} icon="file" />
            <Metric label="Teacher Approved" value={approvedCount} icon="check" />
            <Metric label="Needs Review" value={needsReviewCount} icon="alert" />
            <Metric label="Maximum Marks" value={exam.total_marks} icon="chart" />
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
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter by review status"
              >
                <option value="All">All review statuses</option>
                <option value="Needs Review">Needs Review</option>
                <option value="Teacher Approved">Teacher Approved</option>
              </select>
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon="upload"
                title="No scripts to evaluate"
                description="Upload student answer sheets for this examination first."
                action={
                  <Button icon="upload" onClick={() => go("sheets", { examId: exam.id })}>
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
                      <th>Suggested Score</th>
                      <th>Approved Score</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="person">
                            <span className="initial">{s.avatar_initials || "ST"}</span>
                            <div>
                              <strong>{s.student_name || s.detected_student_name || "Unassigned"}</strong>
                              {(s.flagged_questions || 0) > 0 && (
                                <small className="text-amber">
                                  {s.flagged_questions} flagged question(s)
                                </small>
                              )}
                            </div>
                          </div>
                        </td>
                        <td>{s.student_id_number || s.detected_student_id || "—"}</td>
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
                          <Button
                            kind={s.review_status === "Teacher Approved" ? "secondary" : "primary"}
                            onClick={() =>
                              go("review", { examId: exam.id, submissionId: s.id })
                            }
                          >
                            {s.review_status === "Teacher Approved"
                              ? "Inspect Grading"
                              : "Open Evaluation"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {submissions.length > 0 && (
              <div className={`publish-bar ${needsReviewCount === 0 ? "ready" : ""}`}>
                <div>
                  <Icon name={needsReviewCount === 0 ? "check" : "alert"} />
                  <p>
                    <strong>
                      {needsReviewCount === 0
                        ? "All student evaluations are approved"
                        : `${needsReviewCount} evaluation(s) require teacher verification`}
                    </strong>
                    <span>
                      {needsReviewCount === 0
                        ? "You may proceed to publish results to students."
                        : "Results cannot be published until every script is teacher-approved."}
                    </span>
                  </p>
                </div>
                <Button
                  disabled={needsReviewCount > 0}
                  onClick={() => go("publish", { examId: exam.id })}
                >
                  {exam.status === "Published" ? "View Published Summary" : "Continue to Publish"}
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

