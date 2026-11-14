import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
  PageHead,
  statusTone,
} from "../../components/ui";
import { apiRequest } from "../../lib/api";
import type { Examination, NavState, Question, RecheckRequest, Screen } from "../../types";

export function StudentRechecksPage({
  examId,
  initialQuestionNumber,
  go,
  notify,
}: {
  examId?: number;
  initialQuestionNumber?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [publishedExams, setPublishedExams] = useState<Examination[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<number>(examId || 0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<number>(0);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [rechecks, setRechecks] = useState<RecheckRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadQuestionsForExam = async (targetExamId: number, qNumHint?: number) => {
    if (!targetExamId) return;
    const detail = await apiRequest<{ exam: Examination; questions: Question[] }>(
      `/api/exams/${targetExamId}`
    );
    setQuestions(detail.questions);
    const matchedQ = qNumHint
      ? detail.questions.find((q) => q.question_number === qNumHint)
      : detail.questions[0];
    setSelectedQuestionId(matchedQ?.id || detail.questions[0]?.id || 0);
  };

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, rcRes] = await Promise.all([
        apiRequest<{ exams: Examination[] }>("/api/student/dashboard"),
        apiRequest<{ rechecks: RecheckRequest[] }>("/api/rechecks"),
      ]);
      const pub = dash.exams.filter((e) => e.status === "Published" && e.submission_id);
      setPublishedExams(pub);
      setRechecks(rcRes.rechecks);

      const initialExam =
        (examId && pub.find((e) => e.id === examId)?.id) || pub[0]?.id || 0;
      setSelectedExamId(initialExam);
      if (initialExam) {
        await loadQuestionsForExam(initialExam, initialQuestionNumber);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recheck requests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [examId, initialQuestionNumber]);

  const handleSubmit = async () => {
    if (!selectedExamId || !selectedQuestionId || !reason) {
      notify("Please select an examination, question, and reason.", "error");
      return;
    }
    setSubmitting(true);
    try {
      await apiRequest("/api/rechecks", {
        method: "POST",
        body: JSON.stringify({
          examId: selectedExamId,
          questionId: selectedQuestionId,
          reason,
          comment,
        }),
      });
      notify("Recheck request submitted to your instructor");
      setReason("");
      setComment("");
      await loadAll();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not submit recheck request.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Shell
      screen="recheck"
      go={go}
      title="Recheck Requests"
      breadcrumb="Student Portal / Recheck Requests"
    >
      <PageHead
        title="Recheck Requests"
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={loadAll} />
      ) : (
        <>
          <div className="recheck-layout">
            <section className="card recheck-form">
              <h3>Submit New Recheck Request</h3>
              {publishedExams.length === 0 ? (
                <EmptyState
                  icon="flag"
                  title="No published examinations available"
                  description="You can submit a recheck request once at least one examination result is published."
                />
              ) : (
                <>
                  <label>
                    Published Examination
                    <select
                      value={selectedExamId}
                      onChange={async (e) => {
                        const id = Number(e.target.value);
                        setSelectedExamId(id);
                        await loadQuestionsForExam(id);
                      }}
                    >
                      {publishedExams.map((ex) => (
                        <option key={ex.id} value={ex.id}>
                          {ex.course_code} — {ex.title}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Select Question
                    <select
                      value={selectedQuestionId}
                      onChange={(e) => setSelectedQuestionId(Number(e.target.value))}
                    >
                      {questions.map((q) => (
                        <option key={q.id} value={q.id}>
                          Question {q.question_number} — {q.topic} ({q.max_marks} marks)
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Reason for Recheck
                    <select value={reason} onChange={(e) => setReason(e.target.value)}>
                      <option value="" disabled>
                        Select a reason
                      </option>
                      <option value="My answer may include a valid alternative">
                        My answer may include a valid alternative
                      </option>
                      <option value="Part of my answer may have been missed">
                        Part of my answer may have been missed
                      </option>
                      <option value="Calculation or rubric marks mismatch">
                        Calculation or rubric marks mismatch
                      </option>
                      <option value="I need clarification on the feedback">
                        I need clarification on the feedback
                      </option>
                    </select>
                  </label>

                  <label>
                    Supporting Explanation (Optional)
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Briefly explain why you are requesting a review…"
                      maxLength={500}
                    />
                    <small>{comment.length} / 500</small>
                  </label>

                  <div className="recheck-actions">
                    <Button kind="secondary" onClick={() => go("studentResult")}>
                      Back to Results
                    </Button>
                    <Button disabled={submitting} onClick={handleSubmit}>
                      {submitting ? "Submitting…" : "Submit Recheck Request"}
                    </Button>
                  </div>
                </>
              )}
            </section>

            <aside className="card recheck-info">
              <Icon name="alert" />
              <h3>Before you submit</h3>
              <ul>
                <li>Requests are reviewed directly by your course teacher.</li>
                <li>Your marks remain unchanged until the review is resolved.</li>
                <li>Only one active request is allowed per question at a time.</li>
                <li>Original marks and adjusted marks are preserved in history.</li>
              </ul>
            </aside>
          </div>

          <section className="card section-card" style={{ marginTop: 22 }}>
            <div className="section-title">
              <div>
                <h3>My Recheck Request History ({rechecks.length})</h3>
              </div>
            </div>

            {rechecks.length === 0 ? (
              <p className="popover-empty" style={{ padding: 24 }}>
                You have not submitted any recheck requests yet.
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Examination &amp; Question</th>
                      <th>Reason</th>
                      <th>Marks</th>
                      <th>Status</th>
                      <th>Teacher Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rechecks.map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>
                            {r.course_code} · Q{r.question_number}
                          </strong>
                          <small>{r.exam_title}</small>
                        </td>
                        <td>
                          <strong>{r.reason}</strong>
                          <small>{r.student_comment || "—"}</small>
                        </td>
                        <td>
                          Original: {r.original_marks} / {r.question_max_marks}
                          {r.adjusted_marks !== null && (
                            <small className="text-green">
                              Final: {r.adjusted_marks} / {r.question_max_marks}
                            </small>
                          )}
                        </td>
                        <td>
                          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                        </td>
                        <td>{r.teacher_response || "Awaiting instructor review"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </Shell>
  );
}

