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
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { apiRequest, downloadProtectedFile } from "../../lib/api";
import type { Examination, NavState, QuestionEvaluation, Screen, Submission } from "../../types";

export function StudentResultsPage({
  examId,
  submissionId,
  go,
  notify,
}: {
  examId?: number;
  submissionId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const { user } = useAuth();
  const [publishedExams, setPublishedExams] = useState<Examination[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [evaluations, setEvaluations] = useState<QuestionEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadExamResult = async (targetSubId?: number, targetExamId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const dash = await apiRequest<{ exams: Examination[] }>("/api/student/dashboard");
      const pub = dash.exams.filter((e) => e.status === "Published" && e.submission_id);
      setPublishedExams(pub);

      const matchedExam = targetSubId
        ? pub.find((e) => e.submission_id === targetSubId)
        : targetExamId
          ? pub.find((e) => e.id === targetExamId)
          : pub[0];

      const subIdToFetch = targetSubId || matchedExam?.submission_id;
      if (!subIdToFetch) {
        setSubmission(null);
        setEvaluations([]);
        setLoading(false);
        return;
      }

      const detail = await apiRequest<{
        submission: Submission;
        evaluations: QuestionEvaluation[];
      }>(`/api/submissions/${subIdToFetch}`);
      setSubmission(detail.submission);
      setEvaluations(detail.evaluations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your result.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExamResult(submissionId, examId);
  }, [examId, submissionId]);

  const obtained = submission?.total_approved_marks ?? 0;
  const total = submission?.exam_total_marks ?? 0;
  const pct = total > 0 ? Math.round((obtained / total) * 100) : 0;

  return (
    <Shell
      screen="studentResult"
      go={go}
      title="My Results"
      breadcrumb={submission ? `My Results / ${submission.exam_title}` : "My Results"}
    >
      <PageHead
        title="Examination Results"
        subtitle={
          submission?.published_at
            ? `Published ${new Date(submission.published_at + "Z").toLocaleDateString()}`
            : undefined
        }
        action={
          publishedExams.length > 0 && (
            <select
              value={submission?.id || ""}
              onChange={(e) => loadExamResult(Number(e.target.value))}
              aria-label="Select published examination"
              style={{ minWidth: 260 }}
            >
              {publishedExams.map((ex) => (
                <option key={ex.id} value={ex.submission_id || ""}>
                  {ex.course_code} — {ex.title}
                </option>
              ))}
            </select>
          )
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => loadExamResult(submissionId, examId)} />
      ) : !submission ? (
        <EmptyState
          icon="chart"
          title="No published results available yet"
          description="Your examination results will appear here once your instructor finishes review and publishes them."
        />
      ) : (
        <>
          <div className="result-hero card">
            <div className="result-info">
              <span className="metric-icon">
                <Icon name="book" />
              </span>
              <div>
                <small>
                  {submission.course_title?.toUpperCase()} · {submission.course_code}
                </small>
                <h2>{submission.exam_title}</h2>
                <p>
                  {user?.name} · {user?.student_id_number} · {submission.semester}
                </p>
              </div>
            </div>
            <div className="score-ring">
              <strong>
                {obtained} <small>/ {total}</small>
              </strong>
              <span>{pct}%</span>
            </div>
            <Badge tone="green">Published</Badge>
          </div>

          <div className="result-grid">
            <section className="card section-card">
              <div className="section-title">
                <div>
                  <h3>Question-wise Marks</h3>
                </div>
              </div>
              <div className="question-results">
                {evaluations.map((ev) => (
                  <div key={ev.question_id}>
                    <span className="q-icon">Q{ev.question_number}</span>
                    <div>
                      <strong>Question {ev.question_number}</strong>
                      <small>{ev.topic}</small>
                    </div>
                    <span>
                      <small>Score</small>
                      <strong>
                        {ev.approved_marks ?? 0} / {ev.max_marks}
                      </strong>
                    </span>
                    <Button
                      kind="secondary"
                      onClick={() =>
                        go("studentReview", {
                          examId: submission.exam_id,
                          submissionId: submission.id,
                          questionNumber: ev.question_number,
                        })
                      }
                    >
                      Review
                    </Button>
                  </div>
                ))}
              </div>
            </section>

            <aside>
              <div className="card feedback-summary">
                <span>
                  <Icon name="chart" />
                </span>
                <h3>Teacher Feedback</h3>
                <p>
                  “
                  {submission.teacher_overall_feedback ||
                    "Your evaluation has been verified and approved. Review individual questions for detailed concept feedback."}
                  ”
                </p>
                <small>— {submission.teacher_name}</small>
              </div>

              <div className="card quick-actions">
                <h3>Result Actions</h3>
                <Button
                  onClick={() =>
                    go("studentReview", {
                      examId: submission.exam_id,
                      submissionId: submission.id,
                    })
                  }
                >
                  Review Answer Sheet
                </Button>
                <Button
                  kind="secondary"
                  onClick={() => go("mistakes", { examId: submission.exam_id })}
                >
                  View Mistake Analysis
                </Button>
                <Button
                  kind="secondary"
                  icon="download"
                  onClick={async () => {
                    try {
                      await downloadProtectedFile(
                        `/api/submissions/${submission.id}/feedback-pdf`,
                        `${user?.student_id_number}_Feedback.pdf`
                      );
                      notify("Feedback report PDF downloaded");
                    } catch (err) {
                      notify(err instanceof Error ? err.message : "Download failed.", "error");
                    }
                  }}
                >
                  Download Feedback PDF
                </Button>
              </div>
            </aside>
          </div>
        </>
      )}
    </Shell>
  );
}

