import { useEffect, useState, type ReactNode } from "react";
import { LoadingState, Toast } from "./components/ui";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { LoginPage } from "./pages/LoginPage";
import { MistakeAnalysisPage } from "./pages/student/MistakeAnalysisPage";
import { StudentCoursesPage } from "./pages/student/StudentCoursesPage";
import { StudentDashboard } from "./pages/student/StudentDashboard";
import { StudentProfilePage } from "./pages/student/StudentProfilePage";
import { StudentRechecksPage } from "./pages/student/StudentRechecksPage";
import { StudentResultsPage } from "./pages/student/StudentResultsPage";
import { StudentReviewPage } from "./pages/student/StudentReviewPage";
import { AnswerKeyPage } from "./pages/teacher/AnswerKeyPage";
import { CoursesPage } from "./pages/teacher/CoursesPage";
import { CreateExamPage } from "./pages/teacher/CreateExamPage";
import { EvaluationsPage } from "./pages/teacher/EvaluationsPage";
import { ExaminationsPage } from "./pages/teacher/ExaminationsPage";
import { GradingWorkspacePage } from "./pages/teacher/GradingWorkspacePage";
import { ProcessingPage } from "./pages/teacher/ProcessingPage";
import { PublishResultsPage } from "./pages/teacher/PublishResultsPage";
import { ReportsPage } from "./pages/teacher/ReportsPage";
import { SettingsPage } from "./pages/teacher/SettingsPage";
import { TeacherDashboard } from "./pages/teacher/TeacherDashboard";
import { TeacherRechecksPage } from "./pages/teacher/TeacherRechecksPage";
import { UploadSheetsPage } from "./pages/teacher/UploadSheetsPage";
import type { NavState, Screen } from "./types";

const TEACHER_SCREENS = new Set<Screen>([
  "teacher",
  "courses",
  "examinations",
  "create",
  "key",
  "sheets",
  "processing",
  "evaluations",
  "review",
  "results",
  "publish",
  "teacherRechecks",
  "reports",
  "settings",
]);

const STUDENT_SCREENS = new Set<Screen>([
  "student",
  "studentCourses",
  "studentResult",
  "studentReview",
  "mistakes",
  "recheck",
  "profile",
]);

function EvalDeskRouter() {
  const { user, loading } = useAuth();
  const [screen, setScreen] = useState<Screen>("login");
  const [navState, setNavState] = useState<NavState>({});
  const [toast, setToast] = useState<{ text: string; tone: "success" | "error" } | null>(null);

  const notify = (text: string, tone: "success" | "error" = "success") => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 3000);
  };

  const go = (nextScreen: Screen, state?: NavState) => {
    setScreen(nextScreen);
    setNavState(state || {});
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (screen !== "login") setScreen("login");
      return;
    }
    if (screen === "login") {
      setScreen(user.role === "teacher" ? "teacher" : "student");
      return;
    }
    if (user.role === "teacher" && STUDENT_SCREENS.has(screen)) {
      setScreen("teacher");
    } else if (user.role === "student" && TEACHER_SCREENS.has(screen)) {
      setScreen("student");
    }
  }, [user, loading, screen]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <LoadingState message="Restoring EvalDesk session…" />
      </div>
    );
  }

  if (!user || screen === "login") {
    return (
      <>
        <LoginPage go={go} notify={notify} />
        {toast && <Toast text={toast.text} tone={toast.tone} />}
      </>
    );
  }

  const pages: Record<Screen, ReactNode> = {
    login: <LoginPage go={go} notify={notify} />,
    teacher: <TeacherDashboard go={go} />,
    courses: <CoursesPage go={go} notify={notify} />,
    examinations: <ExaminationsPage go={go} notify={notify} />,
    create: (
      <CreateExamPage
        examId={navState.examId}
        initialCourseId={navState.courseId}
        go={go}
        notify={notify}
      />
    ),
    key: <AnswerKeyPage examId={navState.examId} go={go} notify={notify} />,
    sheets: <UploadSheetsPage examId={navState.examId} go={go} notify={notify} />,
    processing: <ProcessingPage examId={navState.examId} go={go} notify={notify} />,
    evaluations: <EvaluationsPage examId={navState.examId} go={go} />,
    review: (
      <GradingWorkspacePage
        examId={navState.examId}
        submissionId={navState.submissionId}
        initialQuestionNumber={navState.questionNumber}
        go={go}
        notify={notify}
      />
    ),
    results: (
      <PublishResultsPage mode="results" examId={navState.examId} go={go} notify={notify} />
    ),
    publish: (
      <PublishResultsPage mode="publish" examId={navState.examId} go={go} notify={notify} />
    ),
    teacherRechecks: <TeacherRechecksPage go={go} notify={notify} />,
    reports: <ReportsPage go={go} notify={notify} />,
    settings: <SettingsPage go={go} />,
    student: <StudentDashboard go={go} />,
    studentCourses: <StudentCoursesPage go={go} />,
    studentResult: (
      <StudentResultsPage
        examId={navState.examId}
        submissionId={navState.submissionId}
        go={go}
        notify={notify}
      />
    ),
    studentReview: (
      <StudentReviewPage
        examId={navState.examId}
        submissionId={navState.submissionId}
        initialQuestionNumber={navState.questionNumber}
        go={go}
        notify={notify}
      />
    ),
    mistakes: <MistakeAnalysisPage examId={navState.examId} go={go} notify={notify} />,
    recheck: (
      <StudentRechecksPage
        examId={navState.examId}
        initialQuestionNumber={navState.questionNumber}
        go={go}
        notify={notify}
      />
    ),
    profile: <StudentProfilePage go={go} />,
  };

  return (
    <>
      {pages[screen]}
      {toast && <Toast text={toast.text} tone={toast.tone} />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <EvalDeskRouter />
    </AuthProvider>
  );
}
