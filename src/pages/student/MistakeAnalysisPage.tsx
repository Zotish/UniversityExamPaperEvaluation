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
} from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { apiRequest, downloadProtectedFile } from "../../lib/api";
import type { NavState, Screen } from "../../types";

interface MistakesResponse {
  exams: { submission_id: number; exam_id: number; exam_title: string; course_code: string }[];
  selectedExam: { submission_id: number; exam_id: number; exam_title: string; course_code: string } | null;
  summary: {
    totalQuestions: number;
    fullMarksQuestions: number;
    questionsToImprove: number;
  };
  topics: {
    topic: string;
    missedConcepts: string[];
    suggestions: string[];
    questionNumbers: number[];
    marksLost: number;
  }[];
  questions: {
    questionId: number;
    questionNumber: number;
    questionText: string;
    topic: string;
    awardedMarks: number;
    maxMarks: number;
    missingConcepts: string[];
    teacherFeedback: string;
  }[];
}

export function MistakeAnalysisPage({
  examId,
  go,
  notify,
}: {
  examId?: number;
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<MistakesResponse | null>(null);
  const [selectedId, setSelectedId] = useState<number | undefined>(examId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (targetExamId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const qs = targetExamId ? `?examId=${targetExamId}` : "";
      const res = await apiRequest<MistakesResponse>(`/api/student/mistakes${qs}`);
      setData(res);
      if (res.selectedExam) setSelectedId(res.selectedExam.exam_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mistake analysis.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(examId);
  }, [examId]);

  return (
    <Shell
      screen="mistakes"
      go={go}
      title="Mistake Analysis"
      breadcrumb="My Results / Mistake Analysis"
    >
      <PageHead
        title="Mistake Analysis"
        subtitle={
          data?.selectedExam
            ? `${data.selectedExam.course_code} — ${data.selectedExam.exam_title}`
            : undefined
        }
        action={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {data?.exams && data.exams.length > 0 && (
              <select
                value={selectedId || ""}
                onChange={(e) => load(Number(e.target.value))}
                aria-label="Select examination"
              >
                {data.exams.map((ex) => (
                  <option key={ex.exam_id} value={ex.exam_id}>
                    {ex.course_code} — {ex.exam_title}
                  </option>
                ))}
              </select>
            )}
            {data?.selectedExam && (
              <Button
                kind="secondary"
                icon="download"
                onClick={async () => {
                  try {
                    await downloadProtectedFile(
                      `/api/submissions/${data.selectedExam!.submission_id}/feedback-pdf`,
                      `${user?.student_id_number}_Feedback.pdf`
                    );
                    notify("Feedback report PDF downloaded");
                  } catch (err) {
                    notify(err instanceof Error ? err.message : "Download failed.", "error");
                  }
                }}
              >
                Download Feedback Report
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => load(selectedId)} />
      ) : !data?.selectedExam ? (
        <EmptyState
          icon="chart"
          title="No published evaluations yet"
          description="Mistake analysis becomes available after your instructor publishes your graded examination."
        />
      ) : (
        <>
          <div className="metrics three">
            <Metric label="Total Questions" value={data.summary.totalQuestions} icon="file" />
            <Metric
              label="Questions With Full Marks"
              value={data.summary.fullMarksQuestions}
              icon="check"
            />
            <Metric
              label="Questions To Improve"
              value={data.summary.questionsToImprove}
              icon="alert"
            />
          </div>

          <section className="card improvement-card">
            <div className="section-title">
              <div>
                <h3>Topic-wise Improvement Areas</h3>
                <p>Based strictly on missed rubric concepts and approved teacher feedback</p>
              </div>
            </div>

            {data.topics.length === 0 ? (
              <div style={{ padding: 26, textAlign: "center", color: "#15803d" }}>
                <strong>Full marks across every question in this examination!</strong>
              </div>
            ) : (
              data.topics.map((t, i) => (
                <div className="topic-row" key={t.topic}>
                  <span>{i + 1}</span>
                  <div>
                    <small>TOPIC (Q{t.questionNumbers.join(", Q")})</small>
                    <h3>{t.topic}</h3>
                    <Badge tone="amber">−{t.marksLost} marks</Badge>
                  </div>
                  <div>
                    <small>MISSING CONCEPTS</small>
                    <strong>
                      {t.missedConcepts.join("; ") || "Review rubric criteria details."}
                    </strong>
                  </div>
                  <div>
                    <small>TEACHER SUGGESTION</small>
                    <p>
                      {t.suggestions.join(" ") ||
                        "Compare your answer against the reference answer in Answer Review."}
                    </p>
                  </div>
                  <button
                    aria-label={`Review ${t.topic}`}
                    onClick={() =>
                      go("studentReview", {
                        examId: data.selectedExam!.exam_id,
                        submissionId: data.selectedExam!.submission_id,
                        questionNumber: t.questionNumbers[0],
                      })
                    }
                  >
                    <Icon name="arrow" />
                  </button>
                </div>
              ))
            )}
          </section>

          <section className="card section-card" style={{ marginTop: 18 }}>
            <div className="section-title">
              <div>
                <h3>Question-wise Mistake Summary</h3>
                <p>Click any question to inspect your original sheet and reference answer</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Question</th>
                    <th>Topic</th>
                    <th>Score</th>
                    <th>Improvement Notes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {data.questions.map((q) => (
                    <tr key={q.questionId}>
                      <td>
                        <strong>Q{q.questionNumber}</strong>
                        <small>{q.questionText.slice(0, 70)}…</small>
                      </td>
                      <td>{q.topic}</td>
                      <td>
                        <strong>
                          {q.awardedMarks} / {q.maxMarks}
                        </strong>
                      </td>
                      <td>
                        {q.missingConcepts.length > 0
                          ? q.missingConcepts.join(" · ")
                          : q.awardedMarks >= q.maxMarks
                            ? "Full credit achieved"
                            : q.teacherFeedback}
                      </td>
                      <td>
                        <button
                          className="link"
                          onClick={() =>
                            go("studentReview", {
                              examId: data.selectedExam!.exam_id,
                              submissionId: data.selectedExam!.submission_id,
                              questionNumber: q.questionNumber,
                            })
                          }
                        >
                          Inspect <Icon name="arrow" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="center-action">
            <Button
              kind="secondary"
              onClick={() =>
                go("studentResult", {
                  examId: data.selectedExam!.exam_id,
                  submissionId: data.selectedExam!.submission_id,
                })
              }
            >
              ← Return to Results
            </Button>
          </div>
        </>
      )}
    </Shell>
  );
}

