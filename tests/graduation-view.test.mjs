import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TEXT,
  STATUS_LABELS,
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

// ---- 명백히 가상인 진단 응답. 실제 학번·학점·규정·주소가 아니다. ----
// 모양은 서버 API_SPEC.md "GET /graduation-demo"(kumoh-academic-rag@37b7518)를 따른다.
const basis = (rule, extra = {}) => ({ applied_rule: rule, source_title: null, source_url: null, checked_on: null, ...extra });
const row = (id, label, status, current, required, extra = {}) => ({
  id, label, status, current, required, shortfall: null, reason: null, basis: basis("가상 기준"), ...extra,
});

const BASIS_CREDITS = basis("가상 학점 기준", { source_title: "가상 기준표", source_url: "https://example.invalid/rule", checked_on: "2000-01-01" });
const BASIS_MAJOR = basis("가상 전공 기준");
const BASIS_EXTRA = basis("가상 비교과 기준");
const BASIS_MILEAGE = basis("가상 마일리지 기준", { source_title: "가상 비교과 안내", source_url: "http://example.invalid/insecure" });

function creditsItem(status, total, rest = "met", totalExtra = {}) {
  return row("total_credits", "가상 학점", status, null, null, {
    basis: BASIS_CREDITS,
    details: [
      row("credits_total", "가상 총학점", total.status, total.current, total.required, { basis: BASIS_CREDITS, ...totalExtra }),
      row("general_required", "가상 교양필수", rest, 10, 10, { basis: BASIS_CREDITS }),
      row("general_elective", "가상 교양선택", rest, 5, 5, { basis: BASIS_CREDITS }),
      row("msc", "가상 기초", rest, 9, 9, { basis: BASIS_CREDITS }),
      row("major", "가상 전공", rest, 40, 40, { basis: BASIS_CREDITS }),
    ],
  });
}

const D02 = {
  profile: { id: "virtual-d02", label: "가상 학생 둘", department: "가상 학과", admission_year: 2000, admission_type: "가상", track: "가상", is_fictional: true },
  items: [
    creditsItem("met", { status: "met", current: 80, required: 77 }),
    row("major_required", "가상 전공필수", "needs_check", null, null, {
      reason: "가상 상위 확인 사유",
      basis: BASIS_MAJOR,
      details: [
        row("required_courses", "가상 전공필수 과목", "needs_check", null, null, { reason: "가상 과목 확인 필요", basis: BASIS_MAJOR }),
        row("thesis", "가상 졸업논문", "met", 1, 1, { basis: BASIS_MAJOR }),
      ],
    }),
    row("extracurricular", "가상 비교과", "short", null, null, {
      shortfall: 2,
      basis: BASIS_EXTRA,
      details: [
        row("career_education", "가상 진로교육", "met", 1, 1, { basis: BASIS_EXTRA }),
        row("counseling", "가상 상담", "short", 0, 1, { shortfall: 1, basis: BASIS_EXTRA }),
        row("mileage", "가상 마일리지", "short", 10, 30, { shortfall: 20, basis: BASIS_MILEAGE }),
      ],
    }),
  ],
  biskit_recommendations: {
    shortfall_points: 20,
    listed_on: "2000-01-02",
    evaluated_at: "2000-01-02T09:00:00+09:00",
    portal_url: "https://example.invalid/portal",
    programs: [
      {
        title: "가상 프로그램 나", audience: "가상 대상", eligibility: "eligible", apply_until: "2000-01-05", deadline_status: "open",
        event_on: null, mileage_status: "published", mileage_points: 10,
        notice_url: "https://example.invalid/n2", application_url: "https://example.invalid/a2", login_required: true,
      },
      {
        title: "가상 프로그램 가", audience: "가상 대상", eligibility: "needs_check", apply_until: "2000-01-06", deadline_status: "needs_check",
        event_on: "2000-01-07", mileage_status: "undisclosed", mileage_points: null,
        notice_url: null, application_url: "javascript:alert(1)", login_required: false,
      },
    ],
  },
};

// 총학점 부족, 마일리지 충족이라 추천은 null
const D03 = {
  profile: { id: "virtual-d03", label: "가상 학생 셋", is_fictional: true },
  items: [
    creditsItem("short", { status: "short", current: 46, required: 77 }, "short", { shortfall: 31 }),
    row("major_required", "가상 전공필수", "short", null, null, {
      shortfall: 1,
      basis: BASIS_MAJOR,
      details: [row("thesis", "가상 졸업논문", "short", 0, 1, { shortfall: 1, basis: BASIS_MAJOR })],
    }),
    row("extracurricular", "가상 비교과", "met", null, null, {
      basis: BASIS_EXTRA,
      details: [row("mileage", "가상 마일리지", "met", 999, 30, { basis: BASIS_EXTRA })],
    }),
  ],
  biskit_recommendations: null,
};

// 마일리지 120 부족, 추천 후보 없음, 숫자 문자열 분모 0
const D04 = {
  profile: { id: "virtual-d04", label: "가상 학생 넷", is_fictional: true },
  items: [
    creditsItem("met", { status: "met", current: "0.5", required: 0 }),
    row("extracurricular", "가상 비교과", "short", null, null, {
      shortfall: 1,
      basis: BASIS_EXTRA,
      details: [row("mileage", "가상 마일리지", "short", 0, 120, { shortfall: 120, basis: BASIS_EXTRA })],
    }),
  ],
  biskit_recommendations: { shortfall_points: 120, listed_on: "2000-01-02", evaluated_at: null, portal_url: "https://example.invalid/portal", programs: [] },
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
  const title = (n) => n.find((c) => c.className === "grad-item-title")?.textContent;
  const q = {
    title,
    status: () => root.find((n) => n.hasAttribute("data-grad-status")),
    retry: () => root.find((n) => n.hasAttribute("data-grad-retry")),
    result: () => root.find((n) => n.hasAttribute("data-grad-result")),
    section: (key) => q.result().find((n) => n.getAttribute("data-grad-section") === key),
    sections: () => q.result().findAll((n) => n.hasAttribute("data-grad-section")).map((n) => n.getAttribute("data-grad-section")),
    total: () => root.find((n) => n.hasAttribute("data-grad-total")),
    value: () => root.find((n) => n.getAttribute("class") === "grad-ring-value"),
    circles: () => root.findAll((n) => n.tagName === "circle"),
    all: (attr) => root.findAll((n) => n.hasAttribute(attr)),
    titles: (attr) => q.all(attr).map(title),
    items: () => q.all("data-grad-item").map((n) => n.getAttribute("data-grad-item")),
    details: (id) => q.all("data-grad-item").find((n) => n.getAttribute("data-grad-item") === id).findAll((n) => n.hasAttribute("data-grad-detail")),
    part: (node, className) => node.find((n) => n.className === className),
    links: () => root.findAll((n) => n.tagName === "A"),
    urlTexts: () => q.all("data-grad-url-text").map((n) => n.textContent),
    ask: () => root.find((n) => n.hasAttribute("data-grad-ask")),
  };
  return { doc, root, view, calls, q, title };
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

test("상태 이름은 명세의 met·short·needs_check", () => {
  assert.deepEqual(STATUS_LABELS, { met: "충족", short: "부족", needs_check: "확인 필요" });
});

test("normalizeDiagnosis: items[]가 없거나 행이 없으면 형식 오류, 졸업 학점 기본값을 채우지 않는다", () => {
  for (const bad of [null, [], {}, { items: [] }, { items: [null, {}] }, { total: { earned: 1 } }]) {
    assert.throws(() => normalizeDiagnosis(bad), TypeError, JSON.stringify(bad));
  }
  const d = normalizeDiagnosis({ items: [row("total_credits", "가상 학점", "met", null, null, { details: [row("credits_total", "가상 총학점", "met", 3, null)] })] });
  assert.equal(d.total.row.current.text, "3");
  assert.equal(d.total.row.required, null);
  assert.equal(d.recommendations, null);
});

test("normalizeDiagnosis: 배열형 details·basis 필드·객체형 추천을 명세대로 읽는다", () => {
  const d = normalizeDiagnosis(structuredClone(D02));
  assert.deepEqual(d.items.map((item) => [item.id, item.status, item.details.map((r) => r.id)]), [
    ["total_credits", "met", ["credits_total", "general_required", "general_elective", "msc", "major"]],
    ["major_required", "needs_check", ["required_courses", "thesis"]],
    ["extracurricular", "short", ["career_education", "counseling", "mileage"]],
  ]);
  assert.deepEqual(d.unmet.map((r) => [r.owner, r.id, r.status]), [
    ["가상 전공필수", "required_courses", "needs_check"], ["가상 비교과", "counseling", "short"], ["가상 비교과", "mileage", "short"],
  ]);
  assert.deepEqual(d.evidence.map((e) => [e.appliedRule, e.sourceTitle, e.checkedOn, e.url, e.owners.length]), [
    ["가상 학점 기준", "가상 기준표", "2000-01-01", "https://example.invalid/rule", 6],
    ["가상 전공 기준", "", "", null, 3],
    ["가상 비교과 기준", "", "", null, 3],
    ["가상 마일리지 기준", "가상 비교과 안내", "", null, 1],
  ]);
  assert.deepEqual(d.recommendations.programs.map((p) => [p.title, p.notice.url, p.application.url]), [
    ["가상 프로그램 나", "https://example.invalid/n2", "https://example.invalid/a2"],
    ["가상 프로그램 가", null, null],
  ]);
});

// ---- 화면 ----

test("처음에는 로그인 안내만 있고 결과는 비어 있다", () => {
  const { view, q } = mount();
  assert.equal(view.state, "idle");
  assert.equal(q.status().textContent, TEXT.idle);
  assert.equal(q.retry().hidden, true);
  assert.equal(q.result().hidden, true);
  assert.equal(q.result().children.length, 0);
});

test("검토 재현(이전): 명세 구조 응답이 형식 오류로 빠지지 않는다", async () => {
  const data = { items: [row("total_credits", "가상 학점", "met", null, null, { details: [row("credits_total", "가상 총학점", "met", 12, 77)] })] };
  const { view, q } = mount({ loadDiagnosis: async () => data });
  assert.equal(await view.show("virtual-d02"), "ready");
  assert.equal(q.total().textContent, "12 / 77학점");
});

test("검토 재현(최신): 배열형 details의 short 행이 세부 현황과 부족 요건에 나온다", async () => {
  const data = { items: [{ id: "virtual_parent", label: "가상 상위", status: "short", details: [{ id: "msc", label: "가상 영역", current: 1, required: 2, status: "short" }] }] };
  const { view, q } = mount({ loadDiagnosis: async () => data });
  assert.equal(await view.show("virtual-d02"), "ready");
  const [detail] = q.details("virtual_parent");
  assert.equal(q.title(detail), "가상 영역");
  assert.equal(q.part(detail, "grad-item-credits").textContent, "1 / 2");
  assert.equal(q.part(detail, "grad-badge").textContent, "부족");
  assert.equal(q.part(detail, "grad-bar-fill").style.width, "50%");
  assert.deepEqual(q.titles("data-grad-unmet"), ["가상 영역"]);
});

test("가상 d02: 항목·세부 행·부족 요건·근거·BISKIT 추천을 서버 순서대로 그린다", async () => {
  const { view, calls, q, root } = mount({ onAsk: () => {} });
  assert.equal(await view.show("virtual-d02"), "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, "virtual-d02");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(q.status().hidden, true);
  assert.deepEqual(q.sections(), ["total", "items", "unmet", "evidence", "recommendations"]);

  // 총학점 그래프: credits_total 행, 분모는 서버 값, 숫자는 그대로, 비율만 100%로 제한
  assert.equal(q.total().textContent, "80 / 77학점");
  assert.equal(q.value().getAttribute("stroke-dasharray"), "100 100");
  assert.equal(q.value().getAttribute("pathLength"), "100");
  assert.equal(q.circles().length, 2);
  for (const circle of q.circles()) assert.ok(circle.namespaceURI.endsWith("/2000/svg"));
  assert.equal(q.part(q.section("total"), "grad-badge").textContent, "충족");
  assert.equal(q.part(q.section("total"), "grad-profile").textContent, "가상 학생 둘");

  // 상위 행과 세부 행
  assert.deepEqual(q.items(), ["total_credits", "major_required", "extracurricular"]);
  assert.deepEqual(q.details("total_credits").map(q.title), ["가상 총학점", "가상 교양필수", "가상 교양선택", "가상 기초", "가상 전공"]);
  assert.equal(q.part(q.details("total_credits")[1], "grad-item-credits").textContent, "10 / 10학점");
  assert.deepEqual(q.details("extracurricular").map((n) => [q.title(n), n.getAttribute("data-status"), q.part(n, "grad-badge").textContent]), [
    ["가상 진로교육", "met", "충족"], ["가상 상담", "short", "부족"], ["가상 마일리지", "short", "부족"],
  ]);
  const mileage = q.details("extracurricular")[2];
  assert.equal(q.part(mileage, "grad-item-credits").textContent, "10 / 30", "비교과에는 학점 단위를 붙이지 않는다");
  assert.equal(q.part(mileage, "grad-item-detail").textContent, "부족 20");
  assert.equal(q.part(q.details("major_required")[0], "grad-item-detail").textContent, "가상 과목 확인 필요");

  // 부족·확인 필요 요건
  assert.deepEqual(q.titles("data-grad-unmet"), ["가상 전공필수 과목", "가상 상담", "가상 마일리지"]);
  assert.deepEqual(q.all("data-grad-unmet").map((n) => q.part(n, "grad-tag").textContent), ["가상 전공필수", "가상 비교과", "가상 비교과"]);

  // 근거: applied_rule·source_title·checked_on, 같은 근거는 한 번
  const evidence = q.all("data-grad-evidence");
  assert.equal(evidence.length, 4);
  assert.equal(q.part(evidence[0], "citation-snippet").textContent, "가상 학점 기준");
  assert.equal(q.part(evidence[0], "citation-meta").textContent, "가상 기준표 · 확인일 2000-01-01");
  assert.equal(q.part(evidence[0], "grad-tag").textContent, "가상 학점 · 가상 총학점 · 가상 교양필수 · 가상 교양선택 · 가상 기초 · 가상 전공");
  assert.equal(q.part(evidence[3], "citation-meta").textContent, "가상 비교과 안내");

  // BISKIT 추천: 부족량·확인일, 프로그램 순서와 사실, 공지·신청 링크
  assert.equal(q.section("recommendations").find((n) => n.hasAttribute("data-grad-rec-meta")).textContent, "부족 마일리지 20점 · 목록 확인일 2000-01-02");
  assert.deepEqual(q.titles("data-grad-recommend"), ["가상 프로그램 나", "가상 프로그램 가"]);
  assert.deepEqual(q.all("data-grad-facts").map((n) => n.textContent), [
    "신청 마감 2000-01-05 · 마일리지 10점 · BISKIT 로그인 필요",
    "신청 마감 2000-01-06 · 마감 시각 확인 필요 · 행사일 2000-01-07 · 마일리지 미공개 · 재학 상태 확인 필요",
  ]);

  // 링크: https만 a, 나머지는 글자. 새 창 noopener
  assert.deepEqual(q.links().map((a) => [a.getAttribute("data-grad-link"), a.getAttribute("href")]), [
    ["source", "https://example.invalid/rule"],
    ["portal", "https://example.invalid/portal"],
    ["notice", "https://example.invalid/n2"],
    ["apply", "https://example.invalid/a2"],
  ]);
  for (const a of q.links()) {
    assert.equal(a.getAttribute("target"), "_blank");
    assert.equal(a.getAttribute("rel"), "noopener noreferrer");
  }
  assert.deepEqual(q.urlTexts(), ["http://example.invalid/insecure", "javascript:alert(1)"]);
  assert.ok(!root.textContent.includes("virtual-d02"), "학생 ID는 화면에 그리지 않는다");
});

test("가상 d03: 총학점 부족은 서버 숫자 그대로, 추천 null이면 추천 구역이 없다", async () => {
  const { view, q } = mount();
  await view.show("virtual-d03");
  assert.equal(q.total().textContent, "46 / 77학점");
  assert.equal(q.value().getAttribute("stroke-dasharray"), `${Number(((46 / 77) * 100).toFixed(2))} 100`);
  assert.equal(q.part(q.section("total"), "grad-badge").textContent, "부족");
  assert.equal(q.part(q.section("total"), "grad-notice").textContent, "부족 31");
  assert.deepEqual(q.sections(), ["total", "items", "unmet", "evidence"]);
  assert.deepEqual(q.titles("data-grad-unmet"), ["가상 총학점", "가상 교양필수", "가상 교양선택", "가상 기초", "가상 전공", "가상 졸업논문"]);
  assert.equal(q.part(q.all("data-grad-unmet")[0], "grad-item-credits").textContent, "46 / 77학점");
  assert.equal(q.part(q.details("extracurricular")[0], "grad-bar-fill").style.width, "100%");
  assert.equal(q.links().length, 1, "근거 원문 링크 하나만");
  assert.equal(q.ask(), null, "onAsk가 없으면 묻기 버튼도 없다");
});

test("가상 d04: 분모 0과 숫자 문자열, 추천 후보가 없으면 안내만 보인다", async () => {
  const { view, q } = mount();
  await view.show("virtual-d04");
  assert.equal(q.total().textContent, "0.5 / 0학점");
  assert.equal(q.value().getAttribute("stroke-dasharray"), "0 100");
  assert.deepEqual(q.sections(), ["total", "items", "unmet", "evidence", "recommendations"]);
  assert.deepEqual(q.titles("data-grad-unmet"), ["가상 마일리지"]);
  assert.equal(q.part(q.all("data-grad-unmet")[0], "grad-item-detail").textContent, "부족 120");
  const rec = q.section("recommendations");
  assert.equal(rec.find((n) => n.hasAttribute("data-grad-rec-meta")).textContent, "부족 마일리지 120점 · 목록 확인일 2000-01-02");
  assert.equal(rec.find((n) => n.hasAttribute("data-grad-no-programs")).textContent, TEXT.noPrograms);
  assert.equal(q.all("data-grad-recommend").length, 0);
});

test("총학점 행이 없으면 형식 오류 대신 그래프만 빼고 요건을 그린다", async () => {
  const data = { items: [row("extracurricular", "가상 비교과", "met", null, null, { details: [row("mileage", "가상 마일리지", "met", 30, 30)] })] };
  const { view, q } = mount({ loadDiagnosis: async () => data });
  assert.equal(await view.show("virtual-x"), "ready");
  assert.equal(q.circles().length, 0);
  assert.equal(q.total(), null);
  assert.equal(q.section("total").children[0].textContent, TEXT.summaryTitle);
  assert.deepEqual(q.items(), ["extracurricular"]);
});

test("서버 글자는 태그가 되지 않고, 상대 경로 링크도 a로 만들지 않는다", async () => {
  const data = {
    items: [row("extracurricular", "<img src=x onerror=alert(1)>", "short", 0, 1, {
      basis: basis("가상 기준", { source_url: "/relative/path" }),
    })],
    biskit_recommendations: { shortfall_points: 1, portal_url: "javascript:alert(1)", programs: [{ title: "가상", notice_url: "http://example.invalid/x" }] },
  };
  const { view, q, root } = mount({ loadDiagnosis: async () => data });
  await view.show("virtual-x");
  assert.equal(q.links().length, 0);
  assert.deepEqual(q.urlTexts(), ["/relative/path", "javascript:alert(1)", "http://example.invalid/x"]);
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
  assert.equal(q.total().textContent, "80 / 77학점");
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
  assert.equal(q.total().textContent, "46 / 77학점", "늦은 d02가 d03을 덮지 않는다");
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
  const { view, q } = mount({ onAsk: (pending) => asked.push(pending) });
  await view.show("virtual-d02");
  q.ask().click();
  q.ask().click();
  assert.equal(asked.length, 2);
  assert.notEqual(asked[0], asked[1]);
  for (const pending of asked) {
    assert.deepEqual(Object.keys(pending), ["question"]);
    assert.equal(pending.question, ASK_QUESTION);
    assert.doesNotMatch(JSON.stringify(pending), /virtual-d02|가상 학생|80|77/);
  }
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

test("app.css: 졸업 규칙은 포커스 규칙 앞에 있고 링크 터치 영역은 44px 변수", () => {
  const css = read("../web/assets/app.css");
  const focusAt = css.lastIndexOf(":focus-visible");
  for (const selector of [".grad-result", ".grad-ring", ".grad-ring-value", ".grad-badge", ".grad-item", ".grad-row", ".grad-link",
    '.grad-badge[data-status="short"]', '.grad-badge[data-status="needs_check"]']) {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at > 0 && at < focusAt, selector);
  }
  const link = css.indexOf(".grad-link {");
  assert.match(css.slice(link, css.indexOf("}", link)), /min-height:\s*var\(--touch\)/);
  assert.doesNotMatch(css, /@import|url\(\s*["']?https?:/, "외부 글꼴·자원을 불러오지 않는다");
});
