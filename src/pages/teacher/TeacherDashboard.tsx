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
import { useAuth } from "../../context/AuthContext";
import { apiRequest } from "../../lib/api";
import type { AuditEntry, Examination, NavState, Screen } from "../../types";

interface DashboardResponse {
  metrics: {
    activeCourses: number;
    totalExaminations: number;
    pendingEvaluations: number;
    studentsEvaluated: number;
    scriptsNeedingReview: number;
    publishedResults: number;
    openRechecksCount: number;
  };
  recentExams: Examination[];
  pendingWork: {
    id: string;
    category: string;
    title: string;
    subtitle: string;
    targetScreen: Screen;
    examId?: number;
    submissionId?: number;
    tone: "amber" | "red" | "blue";
  }[];
  recentActivity: AuditEntry[];
}

export function TeacherDashboard({
  go,
}: {
  go: (s: Screen, state?: NavState) => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<DashboardResponse>("/api/teacher/dashboard");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load teacher dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const examAction = (exam: Examination): { label: string; screen: Screen } => {
    if (exam.status === "Draft") return { label: "Edit Draft", screen: "create" };
    if (exam.status === "Awaiting Answer Key") return { label: "Upload Key", screen: "key" };
    if (exam.status === "Ready for Upload") return { label: "Upload Sheets", screen: "sheets" };
    if (exam.status === "Needs Review") return { label: "Review", screen: "evaluations" };
    if (exam.status === "Ready to Publish") return { label: "Publish", screen: "publish" };
    return { label: "View Results", screen: "results" };
  };

  return (
    <Shell screen="teacher" go={go} title="Dashboard" breadcrumb="Faculty Workspace">
      <PageHead
        title={`Welcome, ${user?.name || "Faculty"}`}
        action={
          <Button icon="plus" onClick={() => go("create")}>
            Create Examination
          </Button>
        }
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : data ? (
        <>
          <div className="metrics six">
            <Metric
              label="Active Courses"
              value={data.metrics.activeCourses}
              icon="book"
              onClick={() => go("courses")}
            />
            <Metric
              label="Total Examinations"
              value={data.metrics.totalExaminations}
              icon="file"
              onClick={() => go("examinations")}
            />
            <Metric
              label="Pending Evaluations"
              value={data.metrics.pendingEvaluations}
              icon="clock"
              onClick={() => go("evaluations")}
            />
            <Metric
              label="Students Evaluated"
              value={data.metrics.studentsEvaluated}
              icon="users"
              onClick={() => go("evaluations")}
            />
            <Metric
              label="Scripts Needing Review"
              value={data.metrics.scriptsNeedingReview}
              icon="alert"
              onClick={() => go("evaluations")}
            />
            <Metric
              label="Published Results"
              value={data.metrics.publishedResults}
              icon="check"
              onClick={() => go("results")}
            />
          </div>

          <div className="quick-actions-strip card">
            <span>Quick Actions</span>
            <div className="quick-actions-btns">
              <Button kind="secondary" icon="plus" onClick={() => go("create")}>
                Create Examination
              </Button>
              <Button
                kind="secondary"
                icon="upload"
                onClick={() => {
                  const awaiting =
                    data.recentExams.find((e) => e.status === "Awaiting Answer Key") ||
                    data.recentExams[0];
                  go("key", { examId: awaiting?.id });
                }}
              >
                Upload Answer Key
              </Button>
              <Button
                kind="secondary"
                icon="file"
                onClick={() => {
                  const ready =
                    data.recentExams.find((e) => e.status === "Ready for Upload") ||
                    data.recentExams[0];
                  go("sheets", { examId: ready?.id });
                }}
              >
                Upload Student Sheets
              </Button>
              <Button
                kind="secondary"
                icon="clipboard"
                onClick={() => {
                  const rev =
                    data.recentExams.find((e) => e.status === "Needs Review") ||
                    data.recentExams[0];
                  go("evaluations", { examId: rev?.id });
                }}
              >
                Review Evaluations
              </Button>
              <Button
                kind="secondary"
                icon="check"
                onClick={() => {
                  const pub =
                    data.recentExams.find((e) => e.status === "Ready to Publish") ||
                    data.recentExams[0];
                  go("publish", { examId: pub?.id });
                }}
              >
                Publish Results
              </Button>
            </div>
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-left">
              <section className="card section-card">
                <div className="section-title">
                  <div>
                    <h3>Recent Examinations</h3>
                  </div>
                  <button onClick={() => go("examinations")}>View all →</button>
                </div>

                {data.recentExams.length === 0 ? (
                  <EmptyState
                    icon="file"
                    title="No examinations yet"
                    description="Create your first examination to configure answer keys and evaluate student scripts."
                    action={
                      <Button icon="plus" onClick={() => go("create")}>
                        Create Examination
                      </Button>
                    }
                  />
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Examination</th>
                          <th>Course</th>
                          <th>Students</th>
                          <th>Progress</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentExams.map((ex) => {
                          const total = ex.submission_count || 0;
                          const approved = ex.approved_count || 0;
                          const pct = total > 0 ? Math.round((approved / total) * 100) : 0;
                          const act = examAction(ex);
                          return (
                            <tr key={ex.id}>
                              <td>
                                <strong>{ex.title}</strong>
                                <small>{ex.exam_date}</small>
                              </td>
                              <td>
                                {ex.course_code}
                                <small>{ex.course_title}</small>
                              </td>
                              <td>{total}</td>
                              <td>
                                <div className="mini-progress-wrap">
                                  <div className="mini-progress">
                                    <span style={{ width: `${pct}%` }} />
                                  </div>
                                  <small>
                                    {approved}/{total} approved
                                  </small>
                                </div>
                              </td>
                              <td>
                                <Badge tone={statusTone(ex.status)}>{ex.status}</Badge>
                              </td>
                              <td>
                                <button
                                  className="link"
                                  onClick={() => go(act.screen, { examId: ex.id })}
                                >
                                  {act.label} <Icon name="arrow" size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="card section-card" style={{ marginTop: 18 }}>
                <div className="section-title">
                  <div>
                    <h3>Recent Activity</h3>
                  </div>
                </div>
                <div className="activity-list">
                  {data.recentActivity.length === 0 ? (
                    <p className="popover-empty">No recent activity recorded.</p>
                  ) : (
                    data.recentActivity.slice(0, 6).map((act) => (
                      <div className="activity-row" key={act.id}>
                        <span className="activity-dot" />
                        <div>
                          <strong>{act.action}</strong>
                          <small>
                            {act.actor_name} · {new Date(act.created_at + "Z").toLocaleString()}
                          </small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>

            <aside className="card pending">
              <div className="section-title">
                <div>
                  <h3>Pending Work</h3>
                </div>
                <span className="count">{data.pendingWork.length}</span>
              </div>

              {data.pendingWork.length === 0 ? (
                <div style={{ padding: 22, textAlign: "center", color: "#64748b", fontSize: 12 }}>
                  All active examinations and scripts are up to date.
                </div>
              ) : (
                data.pendingWork.map((item) => (
                  <div className="review-item" key={item.id}>
                    <span
                      className={`initial ${
                        item.tone === "red"
                          ? "red-bg"
                          : item.tone === "amber"
                            ? "amber-bg"
                            : ""
                      }`}
                    >
                      <Icon
                        name={item.tone === "red" ? "alert" : item.tone === "blue" ? "flag" : "clock"}
                        size={15}
                      />
                    </span>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.subtitle}</p>
                      <small className={item.tone === "red" ? "text-red" : ""}>
                        {item.category}
                      </small>
                    </div>
                    <button
                      aria-label={`Open ${item.title}`}
                      onClick={() =>
                        go(item.targetScreen, {
                          examId: item.examId,
                          submissionId: item.submissionId,
                        })
                      }
                    >
                      <Icon name="arrow" />
                    </button>
                  </div>
                ))
              )}
            </aside>
          </div>
        </>
      ) : null}
    </Shell>
  );
}

