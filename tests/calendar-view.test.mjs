import { test } from "node:test";
import assert from "node:assert/strict";
import { mountCalendar, TEXT } from "../web/assets/calendar-view.mjs";

class Element {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.className = "";
    this._text = "";
    this.style = {};
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set innerHTML(value) { throw new Error("HTML 삽입 금지"); }
  append(...nodes) {
    for (const node of nodes) node.parent = this;
    this.children.push(...nodes);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
    if (Element.active === this) Element.active = null;
  }
  replaceChildren(...nodes) { this._text = ""; this.children = nodes; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, detail = {}) { return this.listeners.get(type)?.({ target: this, preventDefault() {}, ...detail }); }
  focus() { Element.active = this; }
  byClass(name) { return this.children.flatMap((child) => [...(child.className.split(" ").includes(name) ? [child] : []), ...child.byClass(name)]); }
  all(tag) { return this.children.flatMap((child) => [ ...(child.tagName === tag ? [child] : []), ...child.all(tag)]); }
}

function setup(fetchImpl, options = {}) {
  const doc = { createElement: (tag) => new Element(tag) };
  const root = doc.createElement("div");
  const calls = [];
  const view = mountCalendar({ root, doc, initialYear: 2027, initialTerm: 1,
    fetchImpl: (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); }, ...options });
  const [year, term] = root.all("select");
  if (!options.calendar) root.byClass("calendar-viewswitch")[0].children[1].dispatch("click");
  return { root, view, calls, year, term, status: root.byClass("status")[0], retry: root.byClass("button-secondary")[0], list: root.byClass("calendar-list")[0] };
}

const response = (events) => ({ ok: true, json: async () => ({ events }) });
const event = (day, audience = `가상 대상 ${day}`) => ({
  audience, starts_on: `2027-03-${day}`, ends_on: `2027-04-${day}`,
  sources: [
    { title: `가상 출처 ${day} 가`, url: `https://example.invalid/${day}/a`, checked_on: "2027-01-01" },
    { title: `가상 출처 ${day} 나`, url: `https://example.invalid/${day}/b`, checked_on: "2027-01-02" },
  ],
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// 모든 화면 검사에서 저장소를 읽거나 쓰려고 접근하면 즉시 실패한다.
async function withoutStorage(run) {
  const names = ["localStorage", "sessionStorage"];
  const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  try {
    for (const name of names) Object.defineProperty(globalThis, name, {
      configurable: true, get() { assert.fail(`${name} 접근 금지`); },
      set() { assert.fail(`${name} 쓰기 금지`); },
    });
    await run();
  } finally {
    names.forEach((name, index) => {
      if (originals[index]) Object.defineProperty(globalThis, name, originals[index]);
      else delete globalThis[name];
    });
  }
}

test("2027/1 GET과 선택지, 4건 시작일순·기간·모든 출처와 확인일", () => withoutStorage(async () => {
  const fixture = [event("04"), event("02"), event("01"), event("03")];
  const s = setup(async () => response(fixture));
  assert.equal(s.calls.length, 0);
  assert.deepEqual(s.year.children.map((option) => option.value), ["2026", "2027", "2028"]);
  assert.deepEqual(s.term.children.map((option) => option.value), ["1", "2"]);
  assert.equal(s.year.getAttribute("aria-label"), "학년도");
  const pending = s.view.refresh();
  assert.equal(s.view.refresh(), pending);
  assert.equal(s.status.textContent, TEXT.loading);
  assert.equal(s.list.getAttribute("aria-busy"), "true");
  await pending;
  assert.equal(s.calls[0].url, "https://kumoh-campus.onrender.com/api/v1/academic-calendar/2027/1");
  assert.equal(s.calls[0].init.method, "GET");
  assert.equal(s.calls[0].init.credentials, "omit");
  assert.equal(s.calls[0].init.cache, "no-store");
  assert.deepEqual(s.list.all("h3").map((node) => node.textContent), ["01", "02", "03", "04"].map((day) => `가상 대상 ${day}`));
  assert.equal(s.list.children.length, 4);
  for (const [index, card] of s.list.children.entries()) {
    const day = `0${index + 1}`;
    assert.ok(card.textContent.includes(`2027-03-${day} ~ 2027-04-${day}`));
    for (const source of event(day).sources) {
      assert.ok(card.textContent.includes(source.title));
      assert.ok(card.textContent.includes(`확인일 ${source.checked_on}`));
    }
    assert.ok(card.className.includes("calendar-event"));
  }
  assert.deepEqual(s.list.all("a").map((link) => link.getAttribute("href")),
    ["01", "02", "03", "04"].flatMap((day) => event(day).sources.map((source) => source.url)));
  for (const link of s.list.all("a")) {
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
  }
  assert.equal(s.status.hidden, true);
  assert.equal(s.retry.hidden, true);
  await s.view.refresh();
  assert.equal(s.calls.length, 1);
  assert.equal(fixture[0].starts_on, "2027-03-04");
}));

test("404와 빈 배열은 같은 빈 상태이며 다시 조회하지 않음", () => withoutStorage(async () => {
  for (const result of [{ ok: false, status: 404 }, response([])]) {
    const s = setup(async () => result);
    await s.view.refresh();
    assert.equal(s.status.textContent, TEXT.empty);
    assert.equal(s.status.hidden, false);
    assert.ok(s.status.className.includes("empty-state"));
    assert.equal(s.list.children.length, 0);
    assert.equal(s.retry.hidden, true);
    await s.view.refresh();
    assert.equal(s.calls.length, 1);
  }
}));

test("자동 재시도까지 2회 실패 후 수동 재시도로 회복", () => withoutStorage(async () => {
  let attempts = 0;
  const s = setup(async () => {
    if (++attempts <= 2) throw new TypeError("가상 네트워크 실패");
    return response([event("01")]);
  });
  await s.view.refresh();
  assert.equal(s.calls.length, 2);
  assert.equal(s.status.textContent, TEXT.failed);
  assert.equal(s.retry.hidden, false);
  assert.equal(s.list.children.length, 0);
  const retrying = s.retry.dispatch("click");
  assert.equal(s.view.refresh(), retrying);
  await retrying;
  assert.equal(s.calls.length, 3);
  assert.equal(s.list.children.length, 1);
  assert.equal(s.retry.hidden, true);
}));

test("학기 변경 후 늦은 성공과 실패가 현재 목록을 덮지 않음", () => withoutStorage(async () => {
  for (const lateFailure of [false, true]) {
    const old = deferred();
    const s = setup(async (url) => url.endsWith("/1") ? old.promise : response([event("02", "가상 새 학기")]));
    const first = s.view.refresh();
    s.term.value = "2";
    const second = s.term.dispatch("change");
    assert.equal(s.view.refresh(), second);
    await second;
    assert.ok(s.calls[1].url.endsWith("/2027/2"));
    if (lateFailure) old.reject(new TypeError("가상 이전 학기 실패"));
    else old.resolve(response([event("01", "가상 이전 학기")]));
    await first;
    assert.deepEqual(s.list.all("h3").map((node) => node.textContent), ["가상 새 학기"]);
    assert.equal(s.status.hidden, true);
    assert.equal(s.retry.hidden, true);
  }
}));

test("학년도 변경은 즉시 이전 목록을 비우고 새 학년도를 요청", () => withoutStorage(async () => {
  const next = deferred();
  const s = setup(async (url) => url.includes("/2027/") ? response([event("01")]) : next.promise);
  await s.view.refresh();
  s.year.value = "2028";
  const changing = s.year.dispatch("change");
  assert.equal(s.list.children.length, 0);
  assert.equal(s.status.textContent, TEXT.loading);
  assert.ok(s.calls[1].url.endsWith("/2028/1"));
  next.resolve(response([]));
  await changing;
  assert.equal(s.status.textContent, TEXT.empty);
}));

test("잘못된 시작일은 제외하고 HTTPS만 링크하며 서버 글자는 텍스트로 표시", () => withoutStorage(async () => {
  const safe = event("01", "<img src=x onerror=alert(1)>");
  safe.sources.push({ title: "가상 비보안 출처", url: "javascript:alert(1)", checked_on: "2027-01-03" });
  const s = setup(async () => response([
    null, {}, { starts_on: "2027-02-29" }, { starts_on: "2027-13-01" },
    { starts_on: "2027-3-01" }, { starts_on: "2027-03-01T00:00:00Z" }, safe,
  ]));
  await s.view.refresh();
  assert.equal(s.list.children.length, 1);
  assert.equal(s.list.all("h3")[0].textContent, safe.audience);
  assert.equal(s.root.all("img").length, 0);
  assert.equal(s.list.all("a").length, 2);
  assert.ok(s.root.textContent.includes("가상 비보안 출처 · 확인일 2027-01-03"));
}));

test("달력 기본 보기, 키보드 포커스와 메모리 탐색", () => withoutStorage(async () => {
  const s = setup(async () => response([event("01"), event("02"), event("03"), event("04")]),
    { calendar: true, today: "2027-03-31" });
  await s.view.refresh();
  const switcher = s.root.byClass("calendar-viewswitch")[0];
  assert.equal(switcher.children[0].getAttribute("aria-pressed"), "true");
  assert.equal(s.list.hidden, true);
  const active = () => s.root.byClass("calendar-day").filter((cell) => cell.getAttribute("tabindex") === "0");
  assert.equal(active().length, 1);
  active()[0].dispatch("keydown", { key: "ArrowRight" });
  assert.equal(active().length, 1);
  assert.equal(Element.active, active()[0]);
  assert.ok(active()[0].getAttribute("aria-label").startsWith("2027-04-01"));
  assert.equal(s.root.byClass("calendar-month")[0].getAttribute("role"), "grid");
  assert.ok(s.root.byClass("calendar-bar").length > 0);
  assert.ok(s.root.byClass("calendar-dot").length > 0);
  assert.ok(s.root.byClass("calendar-more").length > 0);
  assert.equal(s.root.byClass("calendar-day-list")[0].all("h3").length, 4);
  s.root.byClass("calendar-nav")[0].children[0].dispatch("click");
  s.root.byClass("calendar-nav")[0].children[2].dispatch("click");
  s.root.byClass("calendar-day")[10].dispatch("click");
  assert.equal(Element.active, active()[0]);
  switcher.children[1].dispatch("click");
  assert.equal(s.list.hidden, false);
  assert.equal(switcher.children[1].getAttribute("aria-pressed"), "true");
  switcher.children[0].dispatch("click");
  assert.equal(s.calls.length, 1);
}));

test("같은 날 시험·휴일 카드는 목록과 날짜별 목록에 분류 클래스를 붙임", () => withoutStorage(async () => {
  const s = setup(async () => response([event("01", "가상 시험"), event("01", "가상 휴일")]),
    { calendar: true, today: "2027-03-01" });
  await s.view.refresh();
  const assertCategories = (container) => {
    for (const [category, audience] of [["exam", "가상 시험"], ["holiday", "가상 휴일"]]) {
      const cards = container.byClass("calendar-cat-" + category).filter((node) => node.tagName === "article");
      assert.equal(cards.length, 1);
      assert.equal(cards[0].all("h3")[0].textContent, audience);
    }
  };
  assertCategories(s.root.byClass("calendar-day-list")[0]);
  s.root.byClass("calendar-viewswitch")[0].all("button").find((node) => node.textContent === "목록").dispatch("click");
  assertCategories(s.list);
  assert.equal(s.calls.length, 1);
}));

test("오늘이 범위 밖이면 첫 일정 월 선택", () => withoutStorage(async () => {
  const s = setup(async () => response([event("02")]), { calendar: true, today: "2026-01-01" });
  await s.view.refresh();
  assert.equal(s.root.byClass("calendar-month-title")[0].textContent, "2027년 3월");
  assert.ok(s.root.byClass("is-selected")[0].getAttribute("aria-label").startsWith("2027-03-02"));
}));

test("일~토 요일 머리 행이 날짜 행보다 먼저 표시됨", () => withoutStorage(async () => {
  const s = setup(async () => response([event("01")]), { calendar: true });
  await s.view.refresh();
  const grid = s.root.byClass("calendar-month")[0];
  const [weekdays] = grid.byClass("calendar-weekdays");
  assert.equal(grid.children[0], weekdays);
  assert.equal(weekdays.getAttribute("role"), "row");
  assert.deepEqual(weekdays.children.map((header) => header.textContent), ["일", "월", "화", "수", "목", "금", "토"]);
  assert.ok(weekdays.children.every((header) => header.getAttribute("role") === "columnheader"));
}));

test("이전·다음 달 버튼이 연속 실행 중에도 포커스를 유지함", () => withoutStorage(async () => {
  const s = setup(async () => response([event("01")]), { calendar: true, today: "2027-03-01" });
  await s.view.refresh();
  const button = (label) => s.root.byClass("calendar-nav")[0].all("button").find((node) => node.textContent === label);
  for (const [label, months] of [["다음 달", [4, 5]], ["이전 달", [4, 3]]]) {
    const control = button(label);
    control.focus();
    for (const month of months) {
      Element.active.dispatch("click");
      assert.equal(button(label), control);
      assert.equal(Element.active, control);
      assert.equal(s.root.byClass("calendar-month-title")[0].textContent, "2027년 " + month + "월");
    }
  }
  assert.equal(s.calls.length, 1);
}));

test("잘못된 응답 형식은 오류와 재시도 표시", () => withoutStorage(async () => {
  const s = setup(async () => ({ ok: true, json: async () => ({ events: null }) }));
  await s.view.refresh();
  assert.equal(s.status.textContent, TEXT.failed);
  assert.equal(s.retry.hidden, false);
  assert.equal(s.list.children.length, 0);
}));
