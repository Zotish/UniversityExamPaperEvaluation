import { useEffect, useState } from "react";
import { DocumentViewer } from "../../components/DocumentViewer";
import { Shell } from "../../components/Shell";
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Icon,
  LoadingState,
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { apiRequest, downloadProtectedFile } from "../../lib/api";
import type { Examination, NavState, QuestionEvaluation, Screen, Submission } from "../../types";

export function StudentReviewPage({
  examId,
  submissionId,
  initialQuestionNumber,
  go,
  notify,
}: {
  examId?: number;
  submissionId?: number;
  initialQuestionNumber?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const { user } = useAuth();
  const [publishedExams, setPublishedExams] = useState<Examination[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [evaluations, setEvaluations] = useState<QuestionEvaluation[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [mobileTab, setMobileTab] = useState<"myAnswer" | "reference" | "feedback" | "sheet">(
    "myAnswer"
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (targetSubId?: number, targetExamId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const dash = await apiRequest<{ exams: Examination[] }>("/api/student/dashboard");
      const pub = dash.exams.filter((e) => e.status === "Published" && e.submission_id);
      setPublishedExams(pub);

      const matched = targetSubId
        ? pub.find((e) => e.submission_id === targetSubId)
        : targetExamId
          ? pub.find((e) => e.id === targetExamId)
          : pub[0];

      const subIdToFetch = targetSubId || matched?.submission_id;
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

      const startIdx = initialQuestionNumber
        ? Math.max(
            0,
            detail.evaluations.findIndex((e) => e.question_number === initialQuestionNumber)
          )
        : 0;
      setQIdx(startIdx);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load answer review.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(submissionId, examId);
  }, [examId, submissionId]);

  const currentEv = evaluations[qIdx];

  return (
    <Shell
      screen="studentReview"
      go={go}
      title="Answer Review"
      breadcrumb={submission ? `${submission.course_code} / Answer Review` : "Answer Review"}
    >
      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => load(submissionId, examId)} />
      ) : !submission || !currentEv ? (
        <EmptyState
          icon="eye"
          title="No published answer reviews available"
          description="Once an instructor publishes your examination results, you can review your original sheet and feedback here."
          action={
            <Button kind="secondary" onClick={() => go("student")}>
              Return to Dashboard
            </Button>
          }
        />
      ) : (
        <>
          <div className="review-top">
            <div>
              <button
                className="back-link"
                onClick={() =>
                  go("studentResult", {
                    examId: submission.exam_id,
                    submissionId: submission.id,
                  })
                }
              >
                ← Back to result overview
              </button>
              <h1>Review Your Answer</h1>
              <p>
                {submission.exam_title} · Question {currentEv.question_number} of{" "}
                {evaluations.length}
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {publishedExams.length > 1 && (
                <select
                  value={submission.id}
                  onChange={(e) => load(Number(e.target.value))}
                  aria-label="Select published exam"
                >
                  {publishedExams.map((ex) => (
                    <option key={ex.id} value={ex.submission_id || ""}>
                      {ex.course_code} — {ex.title}
                    </option>
                  ))}
                </select>
              )}
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
          </div>

          <div className="mobile-tab-bar">
            <button
              className={mobileTab === "myAnswer" ? "active" : ""}
              onClick={() => setMobileTab("myAnswer")}
            >
              My Answer
            </button>
            <button
              className={mobileTab === "reference" ? "active" : ""}
              onClick={() => setMobileTab("reference")}
            >
              Reference
            </button>
            <button
              className={mobileTab === "feedback" ? "active" : ""}
              onClick={() => setMobileTab("feedback")}
            >
              Feedback
            </button>
            <button
              className={mobileTab === "sheet" ? "active" : ""}
              onClick={() => setMobileTab("sheet")}
            >
              Original Sheet
            </button>
          </div>

          <div className="student-review-layout">
            <div className={mobileTab === "sheet" ? "mobile-show" : "mobile-hide-panel"}>
              <DocumentViewer
                fileId={submission.document_id}
                fileName={submission.file_name || "Your Answer Sheet"}
                totalPages={submission.page_count || 1}
                currentPage={currentEv.page_reference}
                highlightLabel={`Question ${currentEv.question_number} · Page ${currentEv.page_reference}`}
                fallbackText={evaluations
                  .map((e) => `Q${e.question_number}: ${e.extracted_answer}`)
                  .join("\n\n")}
              />
            </div>

            <section
              className={`card student-feedback-panel ${
                mobileTab !== "sheet" ? "mobile-show" : "mobile-hide-panel"
              }`}
            >
              <div className="question-tabs wide">
                {evaluations.map((ev, i) => (
                  <button
                    key={ev.question_id}
                    className={i === qIdx ? "active" : ""}
                    onClick={() => setQIdx(i)}
                  >
                    Q{ev.question_number}
                    <small>
                      {ev.approved_marks ?? 0}/{ev.max_marks}
                    </small>
                  </button>
                ))}
              </div>

              <div className="marks-banner">
                <div>
                  <small>MARKS OBTAINED</small>
                  <strong>
                    {currentEv.approved_marks ?? 0} <span>/ {currentEv.max_marks}</span>
                  </strong>
                </div>
                <Badge
                  tone={
                    (currentEv.approved_marks ?? 0) >= currentEv.max_marks ? "green" : "amber"
                  }
                >
                  {(currentEv.approved_marks ?? 0) >= currentEv.max_marks
                    ? "Full Marks"
                    : "Review Recommended"}
                </Badge>
              </div>

              <h3>{currentEv.question_text}</h3>

              <div className={mobileTab === "myAnswer" ? "mobile-show" : "desktop-only-block"}>
                <div className="answer-block">
                  <h4>Your Answer</h4>
                  <p>{currentEv.extracted_answer || "No extracted text recorded."}</p>
                </div>
              </div>

              <div className={mobileTab === "reference" ? "mobile-show" : "desktop-only-block"}>
                <div className="answer-block reference">
                  <h4>Reference Answer</h4>
                  <p>{currentEv.reference_answer}</p>
                </div>
              </div>

              <div className={mobileTab === "feedback" ? "mobile-show" : "desktop-only-block"}>
                <div className="learning-block good">
                  <h4>
                    <Icon name="check" size={14} /> What You Got Right
                  </h4>
                  {currentEv.correct_concepts.length > 0 ? (
                    <ul>
                      {currentEv.correct_concepts.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ fontSize: 11, color: "#475569" }}>
                      See teacher feedback and rubric breakdown below.
                    </p>
                  )}
                </div>

                {currentEv.missing_concepts.length > 0 && (
                  <div className="learning-block improve">
                    <h4>
                      <Icon name="alert" size={14} /> What Needs Improvement
                    </h4>
                    <ul>
                      {currentEv.missing_concepts.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="how">
                  <strong>Teacher Feedback</strong>
                  <p>
                    {currentEv.teacher_feedback ||
                      "Teacher verified this response against the marking rubric."}
                  </p>
                </div>

                <div className="breakdown">
                  <h4>Marks Breakdown</h4>
                  {currentEv.rubric_scores.map((r, i) => (
                    <div key={i}>
                      <span>{r.criterionName}</span>
                      <strong>
                        {r.awardedMarks} / {r.maxMarks}
                      </strong>
                    </div>
                  ))}
                  <div>
                    <strong>Total</strong>
                    <strong>
                      {currentEv.approved_marks ?? 0} / {currentEv.max_marks}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="feedback-actions">
                <Button
                  kind="secondary"
                  onClick={() => go("mistakes", { examId: submission.exam_id })}
                >
                  View Mistake Analysis
                </Button>
                <Button
                  onClick={() =>
                    go("recheck", {
                      examId: submission.exam_id,
                      questionNumber: currentEv.question_number,
                    })
                  }
                >
                  Request Recheck
                </Button>
              </div>
            </section>
          </div>
        </>
      )}
    </Shell>
  );
}

