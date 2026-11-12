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
import { apiRequest } from "../../lib/api";
import type { Course, NavState, Screen } from "../../types";

export function StudentCoursesPage({
  go,
}: {
  go: (s: Screen, state?: NavState) => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ courses: Course[] }>("/api/courses");
      setCourses(res.courses);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load enrolled courses.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = courses.filter((c) => {
    const q = search.trim().toLowerCase();
    return (
      !q ||
      c.code.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      (c.teacher_name || "").toLowerCase().includes(q)
    );
  });

  return (
    <Shell
      screen="studentCourses"
      go={go}
      title="My Courses"
      breadcrumb="Student Portal / Courses"
      searchPlaceholder="Search enrolled courses…"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <PageHead
        title="My Courses"
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="book"
          title="No enrolled courses found"
          description="Courses you are enrolled in will appear here."
        />
      ) : (
        <div className="course-grid">
          {filtered.map((c) => (
            <article className="card course-card" key={c.id}>
              <div className="course-card-top">
                <span className="course-code-pill">{c.code}</span>
                <Badge tone="neutral">{c.semester}</Badge>
              </div>
              <h3>{c.title}</h3>
              <p className="course-dept">Instructor: {c.teacher_name}</p>
              <p className="course-desc">
                {c.description || "Computer Science & Engineering course"}
              </p>
              <div className="course-stats">
                <span>
                  <Icon name="file" size={14} /> {c.exam_count ?? 0} Exam(s)
                </span>
                <span>
                  <Icon name="check" size={14} /> {c.published_exam_count ?? 0} Published
                </span>
              </div>
              <div className="course-actions">
                <Button kind="secondary" onClick={() => go("studentResult")}>
                  View My Results
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </Shell>
  );
}

