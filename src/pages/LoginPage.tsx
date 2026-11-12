import { useState, type FormEvent } from "react";
import { Button, Icon, Logo } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import type { Role, Screen } from "../types";

export function LoginPage({
  go,
  notify,
}: {
  go: (s: Screen) => void;
  notify: (msg: string, tone?: "success" | "error") => void;
}) {
  const { loginWithCredentials, registerAccount, loginDemo } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  // Signup state
  const [regRole, setRegRole] = useState<Role>("student");
  const [name, setName] = useState("");
  const [studentIdNumber, setStudentIdNumber] = useState("");
  const [teacherIdNumber, setTeacherIdNumber] = useState("");
  const [department, setDepartment] = useState("Computer Science and Engineering");
  const [designation, setDesignation] = useState("Lecturer");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);

  const switchMode = (next: "signin" | "signup") => {
    setMode(next);
    setError("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "signin") {
      if (!email.trim() || !password) {
        setError("Please enter your university email and password.");
        return;
      }
      setSubmitting(true);
      try {
        const user = await loginWithCredentials(email, password);
        notify(`Signed in as ${user.name}`);
        go(user.role === "teacher" ? "teacher" : "student");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Authentication failed.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (name.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your university email.");
      return;
    }
    if (regRole === "student" && studentIdNumber.trim().length < 4) {
      setError("Please enter your Student ID (e.g. CSE22006).");
      return;
    }
    if (regRole === "teacher" && !teacherIdNumber.trim()) {
      setError("Please enter your institutional Teacher ID (e.g. FAC-CSE-102).");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setSubmitting(true);
    try {
      const user = await registerAccount({
        role: regRole,
        name: name.trim(),
        email: email.trim(),
        password,
        department: department.trim(),
        designation: regRole === "teacher" ? designation.trim() : undefined,
        studentIdNumber: regRole === "student" ? studentIdNumber.trim() : undefined,
        teacherIdNumber: regRole === "teacher" ? teacherIdNumber.trim() : undefined,
      });
      notify(`Account created for ${user.name}`);
      go(user.role === "teacher" ? "teacher" : "student");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemo = async (role: "teacher" | "student") => {
    setError("");
    setSubmitting(true);
    try {
      const user = await loginDemo(role);
      notify(`Signed in as ${user.name}`);
      go(user.role === "teacher" ? "teacher" : "student");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo login failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="login-header">
          <Logo />
        </div>

        <form className="login-card card" onSubmit={handleSubmit}>
          <div className="auth-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              className={mode === "signin" ? "active" : ""}
              onClick={() => switchMode("signin")}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              className={mode === "signup" ? "active" : ""}
              onClick={() => switchMode("signup")}
            >
              Create account
            </button>
          </div>

          <div className="auth-heading">
            <h2>{mode === "signin" ? "Sign in" : "Create account"}</h2>
          </div>

          {error && (
            <div className="form-error-box" role="alert">
              <Icon name="alert" size={16} />
              <span>{error}</span>
            </div>
          )}

          {mode === "signup" && (
            <>
              <div className="role-switch" role="group" aria-label="Account type">
                <button
                  type="button"
                  className={regRole === "student" ? "active" : ""}
                  onClick={() => {
                    setRegRole("student");
                    setError("");
                  }}
                >
                  Student
                </button>
                <button
                  type="button"
                  className={regRole === "teacher" ? "active" : ""}
                  onClick={() => {
                    setRegRole("teacher");
                    setError("");
                  }}
                >
                  Teacher
                </button>
              </div>

              <label>
                Full name
                <input
                  placeholder={regRole === "teacher" ? "Dr. Nusrat Chowdhury" : "Rakibul Islam"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                />
              </label>

              {regRole === "student" ? (
                <label>
                  Student ID
                  <input
                    placeholder="CSE22006"
                    value={studentIdNumber}
                    onChange={(e) => setStudentIdNumber(e.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label>
                    Teacher ID
                    <input
                      placeholder="FAC-CSE-102"
                      value={teacherIdNumber}
                      onChange={(e) => setTeacherIdNumber(e.target.value)}
                    />
                    <span className="field-hint">
                      Verified against the institutional faculty registry (one-time claim).
                    </span>
                  </label>
                  <div className="auth-row-2">
                    <label>
                      Department
                      <input
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                      />
                    </label>
                    <label>
                      Designation
                      <select
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                      >
                        <option value="Lecturer">Lecturer</option>
                        <option value="Assistant Professor">Assistant Professor</option>
                        <option value="Associate Professor">Associate Professor</option>
                        <option value="Professor">Professor</option>
                      </select>
                    </label>
                  </div>
                </>
              )}
            </>
          )}

          <label>
            University email
            <input
              placeholder="name@stamforduniversity.edu.bd"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>

          <label>
            Password
            <div className="password">
              <input
                placeholder={mode === "signup" ? "At least 8 characters" : "Enter password"}
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                aria-label={showPass ? "Hide password" : "Show password"}
              >
                <Icon name="eye" />
              </button>
            </div>
          </label>

          <div className="forgot">
            {mode === "signin" ? (
              <label className="remember">
                <input type="checkbox" defaultChecked /> Remember session
              </label>
            ) : (
              <span className="field-hint">
                {regRole === "student" ? "Student accounts only" : "Pre-approved Teacher ID required"}
              </span>
            )}
            <button type="button" onClick={() => setHelpOpen(!helpOpen)}>
              {helpOpen ? "Hide demo credentials" : "Demo credentials"}
            </button>
          </div>

          {helpOpen && (
            <div className="demo-creds-box">
              <p>
                <strong>Faculty:</strong> <code>mahmud.rahman@stamforduniversity.edu.bd</code> /{" "}
                <code>EvalDesk@2026</code>
              </p>
              <p>
                <strong>Student:</strong> <code>arif.hasan@stamforduniversity.edu.bd</code> /{" "}
                <code>Student@2026</code>
              </p>
              <p>
                <strong>Unclaimed Teacher IDs (Signup):</strong> <code>FAC-CSE-102</code>,{" "}
                <code>FAC-CSE-103</code>, <code>FAC-CSE-104</code>
              </p>
            </div>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting
              ? mode === "signin"
                ? "Signing in…"
                : "Creating account…"
              : mode === "signin"
                ? "Sign In"
                : `Create ${regRole === "teacher" ? "Faculty" : "Student"} Account`}
          </Button>

          {mode === "signin" && (
            <>
              <div className="divider">
                <span>Quick demo login</span>
              </div>

              <div className="demo-grid">
                <button type="button" disabled={submitting} onClick={() => handleDemo("teacher")}>
                  <div>
                    <strong>Faculty Demo</strong>
                    <small>Dr. Mahmud Rahman</small>
                  </div>
                  <Icon name="arrow" size={15} />
                </button>
                <button type="button" disabled={submitting} onClick={() => handleDemo("student")}>
                  <div>
                    <strong>Student Demo</strong>
                    <small>Arif Hasan (CSE22001)</small>
                  </div>
                  <Icon name="arrow" size={15} />
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
