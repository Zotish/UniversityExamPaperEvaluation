import { useEffect, useState } from "react";
import { Shell } from "../../components/Shell";
import {
  Button,
  EmptyState,
  ErrorBanner,
  LoadingState,
  Metric,
  PageHead,
} from "../../components/ui";
import { apiRequest, downloadProtectedFile } from "../../lib/api";
import type { Examination, NavState, Screen } from "../../types";

interface AnalyticsResponse {
  exams: Examination[];
  analytics: {
    exam: Examination;
    passThreshold: number;
    studentsEvaluated: number;
    averageScore: number;
    highestScore: number;
    lowestScore: number;
    passRate: number;
    distribution: { label: string; count: number }[];
    questionAverages: {
      questionNumber: number;
      topic: string;
      maxMarks: number;
      averageMarks: number;
      averagePercent: number;
      topMissed: { text: string; hits: number }[];
    }[];
  } | null;
}

export function ReportsPage({
  go,
  notify,
}: {
  go: (s: Screen, state?: NavState) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [examId, setExamId] = useState<number | undefined>(undefined);
  const [passThreshold, setPassThreshold] = useState<string>("40");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (targetExamId?: number, threshold?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (targetExamId) params.set("examId", String(targetExamId));
      if (threshold) params.set("passThreshold", threshold);
      const res = await apiRequest<AnalyticsResponse>(
        `/api/teacher/analytics?${params.toString()}`
      );
      setData(res);
      if (res.analytics?.exam && !targetExamId) {
        setExamId(res.analytics.exam.id);
        setPassThreshold(String(res.analytics.passThreshold));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load analytics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const analytics = data?.analytics;
  const maxDist = Math.max(1, ...(analytics?.distribution.map((d) => d.count) || [1]));

  const runExport = async (path: string, filename: string, label: string) => {
    try {
      await downloadProtectedFile(path, filename);
      notify(`${label} downloaded`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Export failed.", "error");
    }
  };

  return (
    <Shell
      screen="reports"
      go={go}
      title="Analytics & Reports"
      breadcrumb="Faculty Workspace / Reports"
    >
      <PageHead
        title="Analytics &amp; Academic Reports"
        action={
          data?.exams &&
          data.exams.length > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={examId || ""}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setExamId(id);
                  load(id, passThreshold);
                }}
                aria-label="Select examination"
                style={{ minWidth: 240 }}
              >
                {data.exams.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.course_code} — {ex.title}
                  </option>
                ))}
              </select>
              <label className="threshold-inline">
                Pass %
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passThreshold}
                  onChange={(e) => {
                    setPassThreshold(e.target.value);
                    load(examId, e.target.value);
                  }}
                  style={{ width: 68, height: 38 }}
                />
              </label>
            </div>
          )
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={() => load(examId, passThreshold)} />
      ) : !analytics ? (
        <EmptyState
          icon="barChart"
          title="No evaluation analytics yet"
          description="Approve student evaluations in an examination to generate analytics and reports."
        />
      ) : (
        <>
          <div className="metrics five">
            <Metric label="Students Evaluated" value={analytics.studentsEvaluated} icon="users" />
            <Metric
              label="Average Score"
              value={`${analytics.averageScore} / ${analytics.exam.total_marks}`}
              icon="chart"
            />
            <Metric
              label="Highest Score"
              value={`${analytics.highestScore} / ${analytics.exam.total_marks}`}
              icon="check"
            />
            <Metric
              label="Lowest Score"
              value={`${analytics.lowestScore} / ${analytics.exam.total_marks}`}
              icon="alert"
            />
            <Metric
              label={`Pass Rate (≥${analytics.passThreshold}%)`}
              value={`${analytics.passRate}%`}
              icon="barChart"
            />
          </div>

          <div className="analytics-grid">
            <section className="card section-card" style={{ padding: 20 }}>
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>Marks Distribution</h3>
              <div className="bar-chart">
                {analytics.distribution.map((b) => (
                  <div className="bar-col" key={b.label}>
                    <span className="bar-val">{b.count}</span>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ height: `${Math.round((b.count / maxDist) * 100)}%` }}
                      />
                    </div>
                    <small>{b.label}</small>
                  </div>
                ))}
              </div>
            </section>

            <section className="card section-card" style={{ padding: 20 }}>
              <h3 style={{ fontSize: 15, marginBottom: 16 }}>Question-wise Average Performance</h3>
              <div className="q-avg-list">
                {analytics.questionAverages.map((q) => (
                  <div className="q-avg-row" key={q.questionNumber}>
                    <div className="q-avg-head">
                      <strong>
                        Q{q.questionNumber} · {q.topic}
                      </strong>
                      <span>
                        {q.averageMarks} / {q.maxMarks} ({q.averagePercent}%)
                      </span>
                    </div>
                    <div className="mini-progress">
                      <span style={{ width: `${q.averagePercent}%` }} />
                    </div>
                    {q.topMissed.length > 0 && (
                      <small className="missed-note">
                        Commonly missed: {q.topMissed.map((m) => `${m.text} (${m.hits})`).join("; ")}
                      </small>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="card section-card" style={{ marginTop: 18, padding: 20 }}>
            <h3 style={{ fontSize: 15, marginBottom: 16 }}>Official Academic Exports</h3>
            <div className="export-buttons-grid">
              <Button
                kind="secondary"
                icon="download"
                onClick={() =>
                  runExport(
                    `/api/exams/${analytics.exam.id}/export/pdf`,
                    "Result_Sheet.pdf",
                    "Examination Result Sheet (PDF)"
                  )
                }
              >
                Examination Result Sheet (PDF)
              </Button>
              <Button
                kind="secondary"
                icon="download"
                onClick={() =>
                  runExport(
                    `/api/exams/${analytics.exam.id}/export/csv?type=results`,
                    "Student_Marks.csv",
                    "Student-wise Marks (CSV)"
                  )
                }
              >
                Student-wise Marks (CSV)
              </Button>
              <Button
                kind="secondary"
                icon="download"
                onClick={() =>
                  runExport(
                    `/api/exams/${analytics.exam.id}/export/csv?type=questions`,
                    "Question_Marks.csv",
                    "Question-wise Marks (CSV)"
                  )
                }
              >
                Question-wise Marks (CSV)
              </Button>
              <Button
                kind="secondary"
                icon="download"
                onClick={() =>
                  runExport(
                    `/api/exams/${analytics.exam.id}/export/csv?type=summary`,
                    "Evaluation_Summary.csv",
                    "Evaluation Summary (CSV)"
                  )
                }
              >
                Evaluation Summary (CSV)
              </Button>
            </div>
          </section>
        </>
      )}
    </Shell>
  );
}

