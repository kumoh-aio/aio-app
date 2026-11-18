import test from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../web/assets/api.mjs";
import { mountDemoLogin } from "../web/assets/demo-login.mjs";

// 서버의 공개 시연 계정만 쓴다. 학점과 진단은 명백한 가상 값이다.
const students = ["02", "03", "04"].map((suffix) => ({
  id: `demo-d${suffix}`, label: `가상 학생 D${suffix}`,
  scenario: "가상 검증 상황", is_fictional: true,
}));

class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this._text = "";
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set innerHTML(value) { assert.fail("HTML 문자열 삽입 금지"); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ""; this.children = [...children]; }
  addEventListener(name, handler) { this.listeners.set(name, [...this.listeners.get(name) ?? [], handler]); }
  async dispatch(name) {
    for (const handler of this.listeners.get(name) ?? []) {
      await handler({ target: this, preventDefault() {} });
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  find(attribute) {
    if (this.attributes.has(attribute)) return this;
    for (const child of this.children) {
      const found = child.find(attribute);
      if (found) return found;
    }
    return null;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function setup({ fetchLogin, fetchDiagnosis, fetchStudents } = {}) {
  const calls = [];
  const shown = [];
  const errors = [];
  let clears = 0;
  const api = createApi({ base: "https://example.invalid", fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    calls.push({ url, options });
    if (path.endsWith("/demo-students")) {
      return fetchStudents ? fetchStudents() : Response.json({ students });
    }
    if (path.endsWith("/demo-login")) {
      if (fetchLogin) return fetchLogin(options);
      const body = JSON.parse(options.body);
      const suffix = body.student_number.slice(-2);
      assert.deepEqual(body, { student_number: `209900${suffix}`, password: `demo-d${suffix}-pass` });
      return Response.json({ student: students.find((student) => student.id === `demo-d${suffix}`) });
    }
    if (path.endsWith("/graduation-demo")) {
      if (fetchDiagnosis) return fetchDiagnosis();
      return Response.json({ profile: { id: new URL(url).searchParams.get("student_id"), is_fictional: true }, items: [] });
    }
    assert.fail("약속하지 않은 API 요청");
  } });
  const doc = { createElement: (tag) => new Element(tag) };
  const root = new Element("div");
  const diagnosis = {
    clear() { clears += 1; },
    async show(id) {
      shown.push(id);
      try { await api.graduationDemo(id); } catch (error) { errors.push(error); }
    },
  };
  const view = mountDemoLogin({ root, doc, loadStudents: () => api.demoStudents(), login: (id) => api.demoLogin(id), diagnosis });
  const select = () => root.find("data-demo-select");
  const submit = () => root.find("data-demo-form").dispatch("submit");
  async function choose(id) {
    select().value = id;
    await select().dispatch("change");
  }
  return { root, view, calls, shown, errors, select, choose, submit, get clears() { return clears; } };
}

for (const student of students) {
  test(`${student.id} 목록 → 로그인 → 진단 순서와 공개 시연 본문·ID 전달`, async () => {
    const flow = setup();
    await flow.view.refresh();
    await flow.choose(student.id);
    await flow.submit();
    assert.deepEqual(flow.calls.map(({ url }) => new URL(url).pathname), [
      "/api/v1/demo-students", "/api/v1/demo-login", "/api/v1/graduation-demo",
    ]);
    assert.deepEqual(flow.shown, [student.id]);
    assert.equal(new URL(flow.calls[2].url).searchParams.get("student_id"), student.id);
    for (const { options } of flow.calls) {
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
    }
  });
}

test("목록에 없거나 변조된 ID는 로그인 POST를 보내지 않는다", async () => {
  const flow = setup();
  await flow.view.refresh();
  for (const id of ["20990099", "real-student-forbidden", "demo-d02 ", "DEMO-D02", "__proto__", ""]) {
    await flow.choose(id);
    await flow.submit();
  }
  assert.equal(flow.calls.filter(({ options }) => options.method === "POST").length, 0);
  assert.deepEqual(flow.shown, []);
});

test("가상 표시가 없거나 공개 시연 세 계정 밖의 목록 항목은 허용하지 않는다", async () => {
  const flow = setup({ fetchStudents: () => Response.json({ students: [
    { ...students[0], is_fictional: false },
    { id: "forged-demo", label: "가상 변조", is_fictional: true },
  ] }) });
  await flow.view.refresh();
  for (const id of ["demo-d02", "forged-demo"]) {
    await flow.choose(id);
    await flow.submit();
  }
  assert.equal(flow.calls.filter(({ options }) => options.method === "POST").length, 0);
});

test("로그인 401 뒤에는 진단 요청이 없다", async () => {
  const flow = setup({ fetchLogin: () => new Response("{}", { status: 401 }) });
  await flow.view.refresh();
  await flow.choose("demo-d02");
  await flow.submit();
  assert.deepEqual(flow.shown, []);
  assert.equal(flow.calls.length, 2);
  assert.match(flow.root.find("data-demo-status").textContent, /시연|로그인|맞지/);
});

test("허용하지 않은 로그인 응답 학생은 진단에 넘기지 않는다", async () => {
  const flow = setup({ fetchLogin: () => Response.json({ student: { id: "forged-demo", is_fictional: true } }) });
  await flow.view.refresh();
  await flow.choose("demo-d02");
  await flow.submit();
  assert.deepEqual(flow.shown, []);
});

test("목록 네트워크 실패 후 재시도할 수 있다", async () => {
  let available = false;
  const flow = setup({ fetchStudents: () => {
    if (!available) throw new TypeError("가상 네트워크 끊김");
    return Response.json({ students });
  } });
  await flow.view.refresh();
  assert.match(flow.root.find("data-demo-status").textContent, /불러|연결|다시/);
  const retry = flow.root.find("data-demo-retry");
  assert.equal(retry.hidden, false);
  available = true;
  await retry.dispatch("click");
  await flow.choose("demo-d03");
  await flow.submit();
  assert.deepEqual(flow.shown, ["demo-d03"]);
});

for (const failure of ["404", "network"]) {
  test(`진단 ${failure} 오류가 진단 화면으로 전달된다`, async () => {
    const flow = setup({ fetchDiagnosis: () => {
      if (failure === "network") throw new TypeError("가상 네트워크 끊김");
      return new Response("{}", { status: 404 });
    } });
    await flow.view.refresh();
    await flow.choose("demo-d04");
    await flow.submit();
    assert.deepEqual(flow.shown, ["demo-d04"]);
    assert.equal(flow.errors.length, 1);
    if (failure === "404") assert.equal(flow.errors[0].status, 404);
    else assert.ok(flow.errors[0] instanceof TypeError);
  });
}

for (const action of ["change", "logout"]) {
  test(`로그인 응답 대기 중 ${action} 뒤 늦은 응답을 무시한다`, async () => {
    const pending = deferred();
    const flow = setup({ fetchLogin: () => pending.promise });
    await flow.view.refresh();
    await flow.choose("demo-d02");
    const submitting = flow.submit();
    const before = flow.clears;
    if (action === "change") await flow.choose("demo-d03");
    else flow.view.logout();
    assert.ok(flow.clears > before);
    pending.resolve(Response.json({ student: students[0] }));
    await submitting;
    assert.deepEqual(flow.shown, []);
  });
}

test("로그아웃과 계정 변경은 진단을 지우고 저장소를 읽거나 쓰지 않는다", async () => {
  let accesses = 0;
  const original = new Map();
  for (const key of ["localStorage", "sessionStorage"]) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, get() {
      accesses += 1;
      throw new Error("저장소 접근 금지");
    } });
  }
  try {
    const flow = setup();
    await flow.view.refresh();
    await flow.choose("demo-d02");
    await flow.submit();
    const before = flow.clears;
    await flow.choose("demo-d03");
    assert.ok(flow.clears > before);
    await flow.submit();
    flow.view.logout();
    assert.equal(accesses, 0);
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
