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
import type { Course, Examination, NavState, Screen } from "../../types";

interface StudentDashboardData {
  metrics: {
    enrolledCourses: number;
    publishedResults: number;
    pendingResults: number;
    feedbackAvailable: number;
    recheckRequests: number;
  };
  courses: Course[];
  exams: Examination[];
}

export function StudentDashboard({
  go,
}: {
  go: (s: Screen, state?: NavState) => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<StudentDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<StudentDashboardData>("/api/student/dashboard");
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load student dashboard.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <Shell screen="student" go={go} title="Dashboard" breadcrumb="Student Portal">
      <PageHead
        title={`Welcome, ${user?.name?.split(" ")[0] || "Student"}`}
        subtitle={user?.student_id_number ? `Student ID: ${user.student_id_number}` : undefined}
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : data ? (
        <>
          <div className="metrics five">
            <Metric
              label="Enrolled Courses"
              value={data.metrics.enrolledCourses}
              icon="book"
              onClick={() => go("studentCourses")}
            />
            <Metric
              label="Published Results"
              value={data.metrics.publishedResults}
              icon="check"
              onClick={() => go("studentResult")}
            />
            <Metric label="Pending Results" value={data.metrics.pendingResults} icon="clock" />
            <Metric
              label="Feedback Ready"
              value={data.metrics.feedbackAvailable}
              icon="eye"
              onClick={() => go("studentReview")}
            />
            <Metric
              label="Recheck Requests"
              value={data.metrics.recheckRequests}
              icon="flag"
              onClick={() => go("recheck")}
            />
          </div>

          <section className="card section-card">
            <div className="section-title">
              <div>
                <h3>Examination Results &amp; Status</h3>
                <p>Only results verified and published by your instructor appear with marks</p>
              </div>
              <button onClick={() => go("studentResult")}>View all results →</button>
            </div>

            {data.exams.length === 0 ? (
              <EmptyState
                icon="file"
                title="No examinations scheduled"
                description="Examinations for your enrolled courses will appear here."
              />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Examination</th>
                      <th>Course</th>
                      <th>Marks</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.exams.map((ex) => {
                      const isPublished = ex.status === "Published" && ex.submission_id;
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
                          <td>
                            <strong>
                              {isPublished
                                ? `${ex.obtained_marks ?? 0} / ${ex.total_marks}`
                                : "Not Released"}
                            </strong>
                          </td>
                          <td>
                            <Badge tone={isPublished ? "green" : statusTone(ex.status)}>
                              {isPublished ? "Published" : "Pending"}
                            </Badge>
                          </td>
                          <td>
                            {isPublished ? (
                              <div className="row-actions">
                                <Button
                                  kind="secondary"
                                  onClick={() =>
                                    go("studentResult", {
                                      examId: ex.id,
                                      submissionId: ex.submission_id ?? undefined,
                                    })
                                  }
                                >
                                  View Result
                                </Button>
                                <button
                                  className="link"
                                  onClick={() =>
                                    go("studentReview", {
                                      examId: ex.id,
                                      submissionId: ex.submission_id ?? undefined,
                                    })
                                  }
                                >
                                  Answer Review
                                </button>
                              </div>
                            ) : (
                              <span className="muted">Awaiting publication</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </Shell>
  );
}

