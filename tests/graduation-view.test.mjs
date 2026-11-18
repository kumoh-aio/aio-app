import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TEXT,
  ASK_QUESTION,
  normalizeDiagnosis,
  ringPercent,
  safeLink,
  mountGraduationDiagnosis,
} from "../web/assets/graduation-view.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---- 가짜 DOM: graduation-view.mjs가 쓰는 만큼만 흉내 낸다. innerHTML은 쓰면 실패한다. ----
class FakeElement {
  constructor(doc, tag, namespaceURI = null) {
    this.ownerDocument = doc;
    this.tagName = namespaceURI ? tag : tag.toUpperCase();
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.hidden = false;
    this.style = {};
    this._text = "";
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }
  set innerHTML(_value) {
    throw new Error("innerHTML 사용 금지");
  }
  setAttribute(name, value) {
    assert.notEqual(name, "style", "style 속성은 CSP에 걸린다");
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  append(...nodes) {
    for (const node of nodes) {
      assert.ok(node instanceof FakeElement, "요소만 붙인다");
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children = [];
    this._text = "";
    this.append(...nodes);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  click() {
    for (const fn of this.listeners.get("click") ?? []) fn({ type: "click", target: this });
  }
  *walk() {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
  find(predicate) {
    for (const node of this.walk()) if (predicate(node)) return node;
    return null;
  }
  findAll(predicate) {
    return [...this.walk()].filter(predicate);
  }
}

function fakeDocument() {
  const doc = {};
  doc.createElement = (tag) => new FakeElement(doc, tag);
  doc.createElementNS = (ns, tag) => new FakeElement(doc, tag, ns);
  return doc;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---- 명백히 가상인 진단 응답. 실제 학번·학점·규정이 아니다. ----
const D02 = {
  total: { earned: 12, required: 77 },
  status: "가상 진행 중",
  eligible: false,
  categories: [
    { name: "가상 영역 나", earned: 5, required: 9, status: "가상 부족", met: false },
    { name: "가상 영역 가", earned: 7, required: 7, status: "가상 충족", met: true },
  ],
  unmet: [
    { title: "가상 요건 둘", detail: "가상 설명 둘", category: "가상 영역 나", url: "https://example.invalid/u2" },
    { title: "가상 요건 하나", detail: "가상 설명 하나" },
  ],
  evidence: [
    { document: "가상 학칙", article: "제0조(가상)", snippet: "가상 인용 문장", url: "https://example.invalid/rule" },
  ],
  biskit: [
    { title: "가상 비교과 다", detail: "가상 추천 이유", url: "https://example.invalid/b3" },
    { title: "가상 비교과 가", url: "https://example.invalid/b1" },
  ],
};

const D03 = {
  total: { earned: 999, required: 100 },
  status: { label: "가상 충족", met: true },
  categories: [{ name: "가상 영역", earned: 50, required: 40, status: "가상 충족", met: true }],
  unmet: [],
  evidence: [{ document: "가상 규정", article: "제1조", snippet: "", url: "https://example.invalid/r1" }],
  biskit: [],
};

// 다른 키 후보(snake_case)와 문자열 숫자, 0 분모
const D04 = {
  total_credits: { completed: "0.5", required: 0 },
  status_label: "가상 확인 필요",
  areas: [{ area: "가상 영역 하나", completed: "0.5" }],
  unmet_requirements: ["가상 문자열 요건"],
  basis: [{ title: "가상 지침", clause: "제9조", text: "가상 근거 문장" }],
  biskit_recommendations: [{ name: "가상 비교과 하나", description: "가상 설명" }],
};

const FIXTURES = { "virtual-d02": D02, "virtual-d03": D03, "virtual-d04": D04 };

function mount({ loadDiagnosis, onAsk } = {}) {
  const doc = fakeDocument();
  const root = doc.createElement("div");
  const calls = [];
  const load = loadDiagnosis ?? (async (id) => structuredClone(FIXTURES[id]));
  const view = mountGraduationDiagnosis({
    root,
    doc,
    onAsk,
    loadDiagnosis: (id, options) => {
      calls.push({ id, options });
      return load(id, options);
    },
  });
  const q = {
    status: () => root.find((n) => n.hasAttribute("data-grad-status")),
    retry: () => root.find((n) => n.hasAttribute("data-grad-retry")),
    result: () => root.find((n) => n.hasAttribute("data-grad-result")),
    sections: () => q.result().findAll((n) => n.hasAttribute("data-grad-section")).map((n) => n.getAttribute("data-grad-section")),
    total: () => root.find((n) => n.hasAttribute("data-grad-total")),
    value: () => root.find((n) => n.getAttribute("class") === "grad-ring-value"),
    circles: () => root.findAll((n) => n.tagName === "circle"),
    badges: () => root.findAll((n) => n.hasAttribute("data-grad-badge")),
    titles: (attr) => root.findAll((n) => n.hasAttribute(attr)).map((n) => n.find((c) => c.className === "grad-item-title")?.textContent),
    all: (attr) => root.findAll((n) => n.hasAttribute(attr)),
    links: () => root.findAll((n) => n.tagName === "A"),
    ask: () => root.find((n) => n.hasAttribute("data-grad-ask")),
  };
  return { doc, root, view, calls, q };
}

// 저장소 쓰기를 세는 가짜 전역 localStorage·sessionStorage
async function withStorageSpy(fn) {
  const writes = [];
  const spy = (name) => ({
    getItem: () => null,
    setItem: (key) => writes.push([name, "setItem", key]),
    removeItem: (key) => writes.push([name, "removeItem", key]),
    clear: () => writes.push([name, "clear"]),
  });
  const saved = {};
  for (const name of ["localStorage", "sessionStorage"]) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    assert.ok(!saved[name] || saved[name].configurable, `${name}를 바꿔 끼울 수 있어야 한다`);
    Object.defineProperty(globalThis, name, { value: spy(name), configurable: true, writable: true });
  }
  try {
    await fn();
  } finally {
    for (const name of ["localStorage", "sessionStorage"]) {
      if (saved[name]) Object.defineProperty(globalThis, name, saved[name]);
      else delete globalThis[name];
    }
  }
  return writes;
}

// ---- 순수 함수 ----

test("ringPercent는 0~100으로 제한하고 분모가 없거나 0 이하면 0", () => {
  assert.equal(ringPercent(12, 77), (12 / 77) * 100);
  assert.equal(ringPercent(999, 100), 100);
  assert.equal(ringPercent(-5, 100), 0);
  assert.equal(ringPercent(5, 0), 0);
  assert.equal(ringPercent(5, undefined), 0);
  assert.equal(ringPercent("x", 10), 0);
});

test("safeLink는 https만 남기고 http·javascript·상대 경로·공백은 막는다", () => {
  assert.equal(safeLink("https://example.invalid/a"), "https://example.invalid/a");
  for (const bad of ["http://example.invalid/a", "javascript:alert(1)", "/relative/path", "relative", "https://exa mple.invalid", "", null, 3]) {
    assert.equal(safeLink(bad), null, String(bad));
  }
});

test("normalizeDiagnosis: 총학점이 없으면 형식 오류, 130 같은 기본값을 채우지 않는다", () => {
  assert.throws(() => normalizeDiagnosis(null), TypeError);
  assert.throws(() => normalizeDiagnosis([]), TypeError);
  assert.throws(() => normalizeDiagnosis({ categories: [] }), TypeError);
  const d = normalizeDiagnosis({ total: { earned: 3 } });
  assert.equal(d.total.earned.text, "3");
  assert.equal(d.total.required, null);
  assert.deepEqual([d.categories, d.unmet, d.evidence, d.recommendations], [[], [], [], []]);
});

// ---- 화면 ----

test("처음과 clear 뒤에는 로그인 안내만 있고 결과는 비어 있다", () => {
  const { view, q } = mount();
  assert.equal(view.state, "idle");
  assert.equal(q.status().textContent, TEXT.idle);
  assert.equal(q.retry().hidden, true);
  assert.equal(q.result().hidden, true);
  assert.equal(q.result().children.length, 0);
});

test("가상 d02: 서버 배열 순서대로 영역·미충족·근거·BISKIT 추천을 그린다", async () => {
  const { view, calls, q } = mount({ onAsk: () => {} });
  assert.equal(await view.show("virtual-d02"), "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "virtual-d02");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(q.status().hidden, true);
  assert.equal(q.result().hidden, false);
  assert.deepEqual(q.sections(), ["total", "categories", "unmet", "evidence", "recommendations"]);

  // 총학점: 분모는 서버 값(77), 숫자는 그대로
  assert.equal(q.total().textContent, "12 / 77학점");
  assert.equal(q.circles().length, 2);
  for (const circle of q.circles()) assert.ok(circle.namespaceURI.endsWith("/2000/svg"));
  assert.equal(q.value().getAttribute("stroke-dasharray"), `${Number(((12 / 77) * 100).toFixed(2))} 100`);
  assert.equal(q.value().getAttribute("pathLength"), "100");

  // 상태: 전체 + 영역별, 충족 여부를 data-met으로
  assert.deepEqual(q.badges().map((b) => [b.textContent, b.getAttribute("data-met")]), [
    ["가상 진행 중", "unmet"], ["가상 부족", "unmet"], ["가상 충족", "met"],
  ]);

  assert.deepEqual(q.titles("data-grad-category"), ["가상 영역 나", "가상 영역 가"]);
  const categories = q.all("data-grad-category");
  assert.equal(categories[0].find((n) => n.className === "grad-item-credits").textContent, "5 / 9학점");
  assert.equal(categories[0].find((n) => n.className === "grad-bar-fill").style.width, `${Number(((5 / 9) * 100).toFixed(2))}%`);
  assert.deepEqual(q.titles("data-grad-unmet"), ["가상 요건 둘", "가상 요건 하나"]);
  assert.deepEqual(q.titles("data-grad-recommend"), ["가상 비교과 다", "가상 비교과 가"]);
  const evidence = q.all("data-grad-evidence");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].children[0].textContent, "가상 학칙 · 제0조(가상)");
  assert.equal(evidence[0].children[1].tagName, "BLOCKQUOTE");

  // 링크: 서버 순서, https, 새 창 noopener
  assert.deepEqual(q.links().map((a) => a.getAttribute("href")), [
    "https://example.invalid/u2", "https://example.invalid/rule", "https://example.invalid/b3", "https://example.invalid/b1",
  ]);
  for (const a of q.links()) {
    assert.equal(a.getAttribute("target"), "_blank");
    assert.equal(a.getAttribute("rel"), "noopener noreferrer");
  }
});

test("가상 d03: 분자가 분모보다 커도 그래프는 100%, 숫자는 서버 값 그대로, 빈 배열 구역은 없다", async () => {
  const { view, q } = mount();
  await view.show("virtual-d03");
  assert.equal(q.total().textContent, "999 / 100학점");
  assert.equal(q.value().getAttribute("stroke-dasharray"), "100 100");
  assert.deepEqual(q.sections(), ["total", "categories", "evidence"]);
  assert.deepEqual(q.badges().map((b) => [b.textContent, b.getAttribute("data-met")]), [["가상 충족", "met"], ["가상 충족", "met"]]);
  assert.equal(q.all("data-grad-category")[0].find((n) => n.className === "grad-bar-fill").style.width, "100%");
  assert.equal(q.ask(), null, "onAsk가 없으면 묻기 버튼도 없다");
});

test("가상 d04: snake_case 키 후보·문자열 숫자·0 분모·문자열 항목도 서버 값대로 그린다", async () => {
  const { view, q } = mount();
  await view.show("virtual-d04");
  assert.equal(q.total().textContent, "0.5 / 0학점");
  assert.equal(q.value().getAttribute("stroke-dasharray"), "0 100");
  assert.deepEqual(q.sections(), ["total", "categories", "unmet", "evidence", "recommendations"]);
  assert.deepEqual(q.badges().map((b) => [b.textContent, b.getAttribute("data-met")]), [["가상 확인 필요", "unknown"]]);
  assert.equal(q.all("data-grad-category")[0].find((n) => n.className === "grad-item-credits").textContent, "0.5학점");
  assert.equal(q.all("data-grad-category")[0].find((n) => n.className === "grad-bar"), null, "분모가 없으면 막대도 없다");
  assert.deepEqual(q.titles("data-grad-unmet"), ["가상 문자열 요건"]);
  assert.equal(q.all("data-grad-evidence")[0].textContent, "가상 지침 · 제9조가상 근거 문장");
  assert.deepEqual(q.titles("data-grad-recommend"), ["가상 비교과 하나"]);
  assert.equal(q.links().length, 0);
});

test("http·javascript·상대 경로 링크는 a로 만들지 않고 글자로만 둔다, 서버 글자는 태그가 되지 않는다", async () => {
  const data = {
    total: { earned: 1, required: 2 },
    unmet: [{ title: "<img src=x onerror=alert(1)>", url: "javascript:alert(1)" }],
    evidence: [{ document: "가상 규정", url: "http://example.invalid/x" }],
    biskit: [{ title: "가상 비교과", url: "/relative/path" }, { title: "가상 비교과 둘", url: "https://example.invalid/ok" }],
  };
  const { view, q, root } = mount({ loadDiagnosis: async () => data });
  await view.show("virtual-x");
  assert.deepEqual(q.links().map((a) => a.getAttribute("href")), ["https://example.invalid/ok"]);
  assert.deepEqual(q.all("data-grad-url-text").map((n) => n.textContent), ["javascript:alert(1)", "http://example.invalid/x", "/relative/path"]);
  assert.equal(q.titles("data-grad-unmet")[0], "<img src=x onerror=alert(1)>");
  assert.ok(!root.find((n) => n.tagName === "IMG"));
});

test("진단 404: 안내와 다시 시도, 다시 시도하면 같은 계정으로 다시 부른다", async () => {
  let attempt = 0;
  const loadDiagnosis = async (id) => {
    attempt += 1;
    if (attempt === 1) throw Object.assign(new Error("서버 요청 실패 (404)"), { status: 404 });
    return structuredClone(FIXTURES[id]);
  };
  const { view, calls, q } = mount({ loadDiagnosis });
  assert.equal(await view.show("virtual-d02"), "notFound");
  assert.equal(view.state, "error");
  assert.equal(q.status().textContent, TEXT.notFound);
  assert.equal(q.status().getAttribute("data-state"), "notFound");
  assert.equal(q.retry().hidden, false);
  assert.equal(q.result().children.length, 0);

  q.retry().click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.map((c) => c.id), ["virtual-d02", "virtual-d02"]);
  assert.equal(view.state, "ready");
  assert.equal(q.retry().hidden, true);
  assert.equal(q.total().textContent, "12 / 77학점");
});

test("네트워크 실패와 형식 오류: 안내와 다시 시도, 이전 계정 결과는 남지 않는다", async () => {
  const queue = [async () => structuredClone(D02), async () => { throw new TypeError("Failed to fetch"); }, async () => ({ nonsense: true })];
  const { view, q } = mount({ loadDiagnosis: () => queue.shift()() });
  await view.show("virtual-d02");
  assert.ok(q.total());

  assert.equal(await view.show("virtual-d03"), "failed");
  assert.equal(q.status().textContent, TEXT.failed);
  assert.equal(q.retry().hidden, false);
  assert.equal(q.result().children.length, 0, "이전 계정 결과를 지운다");
  assert.equal(q.total(), null);

  assert.equal(await view.show("virtual-d04"), "invalid");
  assert.equal(q.status().textContent, TEXT.invalid);
  assert.equal(q.retry().hidden, false);
});

test("새 계정을 열면 이전 결과를 바로 지우고, 늦게 온 이전 계정 응답은 버린다", async () => {
  const gates = { "virtual-d02": deferred(), "virtual-d03": deferred() };
  const { view, calls, q } = mount({ loadDiagnosis: (id) => gates[id].promise });
  const first = view.show("virtual-d02");
  assert.equal(view.state, "loading");
  assert.equal(q.status().textContent, TEXT.loading);
  const second = view.show("virtual-d03");
  assert.equal(calls[0].options.signal.aborted, true, "앞선 요청을 취소한다");
  gates["virtual-d03"].resolve(structuredClone(D03));
  assert.equal(await second, "ready");
  gates["virtual-d02"].resolve(structuredClone(D02));
  assert.equal(await first, "stale");
  assert.equal(q.total().textContent, "999 / 100학점", "늦은 d02가 d03을 덮지 않는다");
});

test("clear 뒤에 늦게 온 응답과 실패는 그리지 않는다", async () => {
  const ok = deferred();
  const { view, q, calls } = mount({ loadDiagnosis: () => ok.promise });
  const pending = view.show("virtual-d02");
  view.clear();
  assert.equal(calls[0].options.signal.aborted, true);
  ok.resolve(structuredClone(D02));
  assert.equal(await pending, "stale");
  assert.equal(view.state, "idle");
  assert.equal(q.status().textContent, TEXT.idle);
  assert.equal(q.result().children.length, 0);

  const bad = deferred();
  const other = mount({ loadDiagnosis: () => bad.promise });
  const failing = other.view.show("virtual-d02");
  other.view.clear();
  bad.reject(Object.assign(new Error("가상 404"), { status: 404 }));
  assert.equal(await failing, "stale");
  assert.equal(other.view.state, "idle");
  assert.equal(other.q.retry().hidden, true);
});

test("결과를 보인 뒤 clear하면 결과를 지우고 다시 시도는 숨긴다", async () => {
  const { view, q } = mount();
  await view.show("virtual-d02");
  view.clear();
  assert.equal(q.result().children.length, 0);
  assert.equal(q.result().hidden, true);
  assert.equal(q.retry().hidden, true);
});

test("아이오에게 묻기는 계정 정보 없는 일반 질문만 넘기고 매번 새 객체다", async () => {
  const asked = [];
  const { view, q, root } = mount({ onAsk: (pending) => asked.push(pending) });
  await view.show("virtual-d02");
  q.ask().click();
  q.ask().click();
  assert.equal(asked.length, 2);
  assert.notEqual(asked[0], asked[1]);
  for (const pending of asked) {
    assert.deepEqual(Object.keys(pending), ["question"]);
    assert.equal(pending.question, ASK_QUESTION);
    assert.doesNotMatch(JSON.stringify(pending), /virtual-d02|12|77/);
  }
  assert.ok(!root.textContent.includes("virtual-d02"), "학생 ID를 화면에 그리지 않는다");
});

test("show는 빈 ID를 거부하고 요청하지 않는다", async () => {
  const { view, calls } = mount();
  for (const bad of ["", "   ", null, undefined, {}, Number.NaN]) {
    await assert.rejects(view.show(bad), TypeError);
  }
  assert.equal(calls.length, 0);
});

test("d02·d03·d04 진단, 실패, clear 흐름에서 localStorage·sessionStorage 쓰기 0회", async () => {
  const writes = await withStorageSpy(async () => {
    const { view } = mount({ onAsk: () => {} });
    for (const id of ["virtual-d02", "virtual-d03", "virtual-d04"]) await view.show(id);
    view.clear();
    const failing = mount({ loadDiagnosis: async () => { throw Object.assign(new Error("가상"), { status: 404 }); } });
    await failing.view.show("virtual-d02");
    failing.q.retry().click();
    await new Promise((resolve) => setImmediate(resolve));
  });
  assert.deepEqual(writes, []);
});

test("필수 주입값이 없으면 예외", () => {
  const doc = fakeDocument();
  assert.throws(() => mountGraduationDiagnosis({ root: doc.createElement("div"), doc }), TypeError);
  assert.throws(() => mountGraduationDiagnosis({ doc, loadDiagnosis: async () => ({}) }), TypeError);
});

// ---- 정적 파일 검사 ----

test("graduation-view.mjs는 innerHTML류·저장소·외부 주소를 쓰지 않고 이름 규칙을 지킨다", () => {
  const source = read("../web/assets/graduation-view.mjs");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(source, /\bfetch\(/, "조회는 주입받은 함수로만 한다");
  const urls = [...source.matchAll(/https?:\/\/[^\s"'`]+/g)].map((m) => m[0]);
  assert.deepEqual(urls, ["http://www.w3.org/2000/svg"], "SVG 이름공간 말고는 주소가 없다");
  assert.doesNotMatch(source, /테크모|금오AI/);
  assert.doesNotMatch(source, /\b130\b/, "졸업 학점을 고정하지 않는다");
  for (const [, spec] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    assert.match(spec, /^\.\/[\w-]+\.m?js$/, spec);
  }
});

test("app.css: 졸업 규칙은 포커스 규칙 앞에 있고 링크·버튼 터치 영역은 44px 변수", () => {
  const css = read("../web/assets/app.css");
  const focusAt = css.lastIndexOf(":focus-visible");
  for (const selector of [".grad-result", ".grad-ring", ".grad-ring-value", ".grad-badge", ".grad-item", ".grad-link"]) {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at > 0 && at < focusAt, selector);
  }
  const link = css.indexOf(".grad-link {");
  assert.match(css.slice(link, css.indexOf("}", link)), /min-height:\s*var\(--touch\)/);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/, "외부 글꼴·자원을 불러오지 않는다");
});
