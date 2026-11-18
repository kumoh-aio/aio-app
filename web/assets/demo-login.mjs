const DEMO_IDS = new Set(["demo-d02", "demo-d03", "demo-d04"]);

export function mountDemoLogin({ root, doc, loadStudents, login, diagnosis }) {
  let ids = new Set();
  let studentId = null;
  let generation = 0;
  let loaded = false;
  let loading = null;

  const panel = doc.createElement("form");
  panel.className = "card";
  panel.setAttribute("data-demo-form", "");
  const label = doc.createElement("label");
  label.textContent = "시연 계정";
  const select = doc.createElement("select");
  select.setAttribute("data-demo-select", "");
  select.setAttribute("aria-label", "시연 계정");
  label.append(select);
  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.textContent = "시연 계정으로 진단하기";
  submit.disabled = true;
  const logoutButton = doc.createElement("button");
  logoutButton.type = "button";
  logoutButton.textContent = "로그아웃";
  logoutButton.setAttribute("data-demo-logout", "");
  const status = doc.createElement("p");
  status.setAttribute("data-demo-status", "");
  status.setAttribute("role", "status");
  status.textContent = "가상 시연 계정으로만 진단합니다.";
  const retry = doc.createElement("button");
  retry.type = "button";
  retry.textContent = "계정 목록 다시 불러오기";
  retry.setAttribute("data-demo-retry", "");
  retry.hidden = true;
  panel.append(label, submit, logoutButton, status, retry);
  root.replaceChildren(panel);

  function logout() {
    generation += 1;
    studentId = null;
    diagnosis.clear();
    submit.disabled = !loaded;
    status.textContent = "시연 계정을 선택해 주세요.";
  }

  async function refresh() {
    if (loaded) return;
    if (loading) return loading;
    status.textContent = "시연 계정을 불러오고 있어요.";
    retry.hidden = true;
    loading = (async () => {
      try {
        const data = await loadStudents();
        if (!Array.isArray(data?.students)) throw new Error("invalid students");
        const students = data.students.filter((student) =>
          student?.is_fictional === true && DEMO_IDS.has(student.id));
        if (!students.length) throw new Error("empty students");
        ids = new Set(students.map((student) => student.id));
        select.replaceChildren();
        for (const student of students) {
          const option = doc.createElement("option");
          option.value = student.id;
          option.textContent = typeof student.label === "string" ? student.label : student.id;
          select.append(option);
        }
        select.value = students[0].id;
        loaded = true;
        submit.disabled = false;
        status.textContent = "가상 시연 계정으로만 진단합니다.";
      } catch {
        status.textContent = "시연 계정을 불러오지 못했어요. 다시 시도해 주세요.";
        retry.hidden = false;
      } finally {
        loading = null;
      }
    })();
    return loading;
  }

  panel.addEventListener("submit", async (event) => {
    event.preventDefault();
    logout();
    const id = select.value;
    if (!ids.has(id) || !DEMO_IDS.has(id)) {
      status.textContent = "시연 계정을 선택해 주세요.";
      return;
    }
    const current = generation;
    submit.disabled = true;
    status.textContent = "시연 계정에 로그인하고 있어요.";
    try {
      const data = await login(id);
      if (current !== generation) return;
      if (data?.student?.is_fictional !== true || !ids.has(data.student.id)
          || data.student.id !== id) throw new Error("invalid student");
      studentId = data.student.id;
      status.textContent = "시연 계정으로 로그인했어요.";
      await diagnosis.show(studentId);
    } catch (error) {
      if (current !== generation) return;
      studentId = null;
      diagnosis.clear();
      status.textContent = error.status === 401
        ? "시연 계정으로 로그인하지 못했어요. 계정을 다시 선택해 주세요."
        : "시연 계정 요청에 실패했어요. 다시 시도해 주세요.";
    } finally {
      if (current === generation) submit.disabled = false;
    }
  });
  select.addEventListener("change", logout);
  logoutButton.addEventListener("click", logout);
  retry.addEventListener("click", refresh);
  return { ready: Promise.resolve(), refresh, logout };
}
