import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MODES,
  DEFAULT_MODE,
  MODE_STORAGE_KEY,
  SHORTCUTS,
  FAQ,
  TEXT,
  readMode,
  saveMode,
  normalizeQuestion,
  safeGuideItems,
  mountHome,
} from "../web/assets/home.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const API_ORIGIN = "https://kumoh-campus.onrender.com";

// ---- 가짜 DOM: home.mjs가 쓰는 만큼만 흉내 낸다. innerHTML은 쓰면 실패한다. ----
class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.hidden = false;
    this.value = "";
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
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
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
  dispatch(type) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
    };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  focus() {
    this.ownerDocument.activeElement = this;
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
  const doc = { activeElement: null };
  doc.createElement = (tag) => new FakeElement(doc, tag);
  return doc;
}

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
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

// 명백히 가상인 캠퍼스 안내
const FAKE_GUIDE = [
  { title: "가상 도서관 안내", url: "https://example.invalid/library", note: "가상 메모" },
  { title: "가상 식당", url: "https://example.invalid/food" },
];

function mount({ storage = fakeStorage(), loadCampusGuide = async () => FAKE_GUIDE } = {}) {
  const doc = fakeDocument();
  const root = doc.createElement("div");
  const moves = [];
  const home = mountHome({
    root,
    doc,
    storage,
    loadCampusGuide,
    navigate: (route, state) => moves.push(state === undefined ? { route } : { route, state }),
  });
  const q = {
    form: () => root.find((n) => n.tagName === "FORM"),
    input: () => root.find((n) => n.tagName === "TEXTAREA"),
    error: () => root.find((n) => n.getAttribute("id") === "ask-error"),
    mode: (value) => root.find((n) => n.getAttribute("data-mode") === value),
    shortcuts: () => root.findAll((n) => n.hasAttribute("data-shortcut")),
    faq: () => root.findAll((n) => n.hasAttribute("data-faq")),
    status: () => root.find((n) => n.hasAttribute("data-campus-status")),
    retry: () => root.find((n) => n.hasAttribute("data-campus-retry")),
    links: () => root.findAll((n) => n.tagName === "A"),
  };
  return { doc, root, home, moves, storage, q };
}

// ---- 순수 함수 ----

test("답변 모드는 fast·deep이고 기본값은 fast", () => {
  assert.deepEqual([...MODES], ["fast", "deep"]);
  assert.equal(DEFAULT_MODE, "fast");
  assert.equal(readMode(fakeStorage()), "fast");
  assert.equal(readMode(fakeStorage({ [MODE_STORAGE_KEY]: "deep" })), "deep");
  assert.equal(readMode(fakeStorage({ [MODE_STORAGE_KEY]: "turbo" })), "fast");
  assert.equal(readMode(null), "fast");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readMode(broken), "fast");
  assert.doesNotThrow(() => saveMode(broken, "deep"));
  assert.throws(() => saveMode(fakeStorage(), "turbo"), RangeError);
});

test("normalizeQuestion은 공백만 있는 질문을 빈 문자열로 만든다", () => {
  assert.equal(normalizeQuestion("  \n\t "), "");
  assert.equal(normalizeQuestion(undefined), "");
  assert.equal(normalizeQuestion("  가상 질문  "), "가상 질문");
});

test("safeGuideItems는 https 링크와 제목이 있는 항목만 남긴다", () => {
  const items = safeGuideItems([
    { title: " 가상 안내 ", url: "https://example.invalid/a", note: " 메모 " },
    { title: "http 링크", url: "http://example.invalid/b" },
    { title: "스크립트", url: "javascript:alert(1)" },
    { title: "데이터", url: "data:text/html,x" },
    { title: "", url: "https://example.invalid/c" },
    { title: "주소 없음" },
    { title: "잘못된 주소", url: "not a url" },
    null,
    "문자열",
  ]);
  assert.deepEqual(items, [{ title: "가상 안내", url: "https://example.invalid/a", note: "메모" }]);
  assert.deepEqual(safeGuideItems(null), []);
  assert.deepEqual(safeGuideItems({ items: [] }), []);
});

test("바로가기는 승인안대로 8칸이고 초안에는 숫자가 없다", () => {
  assert.equal(SHORTCUTS.length, 8);
  assert.deepEqual(
    SHORTCUTS.map((s) => s.label),
    ["학사 규정 질문", "졸업 요건", "수강신청·학점", "휴학·복학", "장학금", "성적·학사경고", "증명서 발급 안내", "학사일정"],
  );
  assert.deepEqual(
    SHORTCUTS.map((s) => s.route),
    ["aio", "graduation", "aio", "aio", "aio", "aio", "aio", "calendar"],
  );
  assert.equal(new Set(SHORTCUTS.map((s) => s.id)).size, 8);
  for (const s of SHORTCUTS) {
    if (s.draft) assert.doesNotMatch(s.draft, /\d/, s.id);
  }
  assert.ok(Object.isFrozen(SHORTCUTS));
});

test("많이 묻는 질문은 질문만 담는다", () => {
  assert.ok(FAQ.length >= 3);
  for (const question of FAQ) {
    assert.equal(typeof question, "string");
    assert.match(question, /\?$/);
    assert.doesNotMatch(question, /\d/);
  }
});

// ---- 화면 ----

test("홈은 질문 상자, 바로가기, 많이 묻는 질문, 캠퍼스 바로가기 순서로 그린다", async () => {
  const { root, home, q } = mount();
  await home.ready;
  assert.equal(root.children.length, 4);
  assert.equal(root.children[0].tagName, "FORM");
  assert.deepEqual(
    root.children.slice(1).map((section) => section.children[0].textContent),
    [TEXT.shortcutsTitle, TEXT.faqTitle, TEXT.campusTitle],
  );
  assert.ok(root.textContent.includes("아이오에게 물어보세요"));
  assert.ok(!/테크모|금오AI/.test(root.textContent));
  assert.equal(q.shortcuts().length, 8);
  assert.equal(q.faq().length, FAQ.length);
  for (const node of root.walk()) {
    if (node.tagName === "BUTTON") assert.ok(node.getAttribute("type"), "버튼 type 지정");
  }
});

test("빈 질문은 막고 안내를 보여 준다", async () => {
  const { doc, moves, q, home } = mount();
  await home.ready;
  q.input().value = "   ";
  const event = q.form().dispatch("submit");
  assert.ok(event.defaultPrevented);
  assert.deepEqual(moves, []);
  assert.equal(q.error().hidden, false);
  assert.equal(q.error().textContent, TEXT.askEmpty);
  assert.equal(q.input().getAttribute("aria-invalid"), "true");
  assert.equal(doc.activeElement, q.input());

  q.input().value = "가상 질문";
  q.input().dispatch("input");
  assert.equal(q.error().hidden, true);
  assert.equal(q.input().getAttribute("aria-invalid"), null);
});

test("질문하기는 { question, mode }를 아이오 탭으로 넘기고 상자를 비운다", async () => {
  const { moves, q, home } = mount();
  await home.ready;
  q.input().value = "  가상 학생의 가상 질문  ";
  const event = q.form().dispatch("submit");
  assert.ok(event.defaultPrevented);
  assert.deepEqual(moves, [{ route: "aio", state: { question: "가상 학생의 가상 질문", mode: "fast" } }]);
  assert.equal(q.input().value, "");
});

test("답변 모드를 바꾸면 저장하고 질문에 실어 보낸다", async () => {
  const storage = fakeStorage();
  const { moves, q, home } = mount({ storage });
  await home.ready;
  assert.equal(q.mode("fast").getAttribute("aria-pressed"), "true");
  assert.equal(q.mode("deep").getAttribute("aria-pressed"), "false");
  assert.equal(q.mode("deep").textContent, "깊이 생각");

  q.mode("deep").dispatch("click");
  assert.equal(home.mode, "deep");
  assert.equal(storage.data.get(MODE_STORAGE_KEY), "deep");
  assert.equal(q.mode("deep").getAttribute("aria-pressed"), "true");
  assert.equal(q.mode("fast").getAttribute("aria-pressed"), "false");

  q.faq()[0].dispatch("click");
  assert.deepEqual(moves.at(-1), { route: "aio", state: { question: FAQ[0], mode: "deep" } });
});

test("저장된 모드로 시작한다", async () => {
  const { home, q } = mount({ storage: fakeStorage({ [MODE_STORAGE_KEY]: "deep" }) });
  await home.ready;
  assert.equal(home.mode, "deep");
  assert.equal(q.mode("deep").getAttribute("aria-pressed"), "true");
});

test("바로가기는 탭으로 가거나 질문 초안을 넘긴다", async () => {
  const { moves, q, home } = mount();
  await home.ready;
  for (const button of q.shortcuts()) button.dispatch("click");
  assert.deepEqual(
    moves,
    SHORTCUTS.map((s) => (s.draft ? { route: "aio", state: { question: s.draft, mode: "fast" } } : { route: s.route })),
  );
});

test("캠퍼스 바로가기: 로딩 뒤 https 링크를 textContent로 그린다", async () => {
  const pending = deferred();
  const { q, home, root } = mount({ loadCampusGuide: () => pending.promise });
  assert.equal(q.status().getAttribute("data-state"), "loading");
  assert.equal(q.status().textContent, TEXT.campusLoading);
  assert.equal(q.retry().hidden, true);

  pending.resolve([
    ...FAKE_GUIDE,
    { title: "<img src=x onerror=alert(1)>", url: "https://example.invalid/x" },
    { title: "차단될 링크", url: "javascript:alert(1)" },
  ]);
  await home.ready;
  assert.equal(q.status().getAttribute("data-state"), "ready");
  assert.equal(q.status().hidden, true);
  const links = q.links();
  assert.equal(links.length, 3);
  assert.deepEqual(links.map((a) => a.getAttribute("href")), [
    "https://example.invalid/library",
    "https://example.invalid/food",
    "https://example.invalid/x",
  ]);
  for (const a of links) {
    assert.equal(a.getAttribute("target"), "_blank");
    assert.equal(a.getAttribute("rel"), "noopener noreferrer");
  }
  assert.equal(links[0].textContent, "가상 도서관 안내가상 메모");
  assert.equal(links[2].textContent, "<img src=x onerror=alert(1)>");
  assert.ok(!root.find((n) => n.tagName === "IMG"));
});

test("캠퍼스 바로가기: 빈 응답이면 빈 상태", async () => {
  const { q, home } = mount({ loadCampusGuide: async () => [] });
  await home.ready;
  assert.equal(q.status().getAttribute("data-state"), "empty");
  assert.equal(q.status().textContent, TEXT.campusEmpty);
  assert.equal(q.retry().hidden, true);
  assert.equal(q.links().length, 0);
});

test("캠퍼스 바로가기: 실패하면 다시 시도로 회복한다", async () => {
  let calls = 0;
  const { q, home } = mount({
    loadCampusGuide: async () => {
      calls += 1;
      if (calls === 1) throw new Error("가짜 네트워크 오류");
      return FAKE_GUIDE;
    },
  });
  await home.ready;
  assert.equal(q.status().getAttribute("data-state"), "error");
  assert.equal(q.status().textContent, TEXT.campusError);
  assert.equal(q.retry().hidden, false);

  q.retry().dispatch("click");
  assert.equal(q.status().getAttribute("data-state"), "loading");
  assert.equal(q.retry().hidden, true);
  await home.reload(); // 다시 시도와 같은 경로
  assert.equal(calls, 3);
  assert.equal(q.status().getAttribute("data-state"), "ready");
  assert.equal(q.links().length, 2);
});

test("늦게 도착한 이전 응답은 버린다", async () => {
  const first = deferred();
  const second = deferred();
  const queue = [first, second];
  const { q, home } = mount({ loadCampusGuide: () => queue.shift().promise });
  const again = home.reload();
  second.resolve([FAKE_GUIDE[1]]);
  await again;
  first.resolve(FAKE_GUIDE);
  await home.ready;
  assert.deepEqual(q.links().map((a) => a.textContent), ["가상 식당"]);
});

test("필수 주입값이 없으면 예외", () => {
  const doc = fakeDocument();
  assert.throws(() => mountHome({ root: doc.createElement("div"), doc, navigate() {} }), TypeError);
  assert.throws(() => mountHome({ root: doc.createElement("div"), doc, loadCampusGuide: async () => [] }), TypeError);
});

// ---- 정적 파일 검사 ----

test("화면 모듈은 innerHTML류와 외부 주소를 쓰지 않는다", () => {
  for (const path of ["../web/assets/home.mjs", "../web/assets/router.mjs", "../web/assets/app.js"]) {
    const source = read(path);
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, path);
    assert.doesNotMatch(source, /https?:\/\//, path);
    for (const [, spec] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      assert.match(spec, /^\.\/[\w-]+\.m?js$/, `${path}: ${spec}`);
    }
  }
});

test("app.js는 config의 API_BASE와 api의 createApi로 부팅하고 ./sw.js를 등록한다", () => {
  const source = read("../web/assets/app.js");
  assert.match(source, /import\s*\{\s*API_BASE\s*\}\s*from\s*"\.\/config\.mjs"/);
  assert.match(source, /import\s*\{\s*createApi\s*\}\s*from\s*"\.\/api\.mjs"/);
  assert.match(source, /createApi\(\{\s*base:\s*API_BASE/);
  assert.match(source, /serviceWorker\.register\("\.\/sw\.js"\)/);
});

test("index.html: CSP는 default-src 'self'에 API 주소만 connect-src로 더한다", () => {
  const html = read("../web/index.html");
  const metas = [...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/gi)];
  assert.equal(metas.length, 1);
  const directives = Object.fromEntries(
    metas[0][1].split(";").map((part) => part.trim().split(/\s+/)).filter((p) => p[0]).map(([name, ...values]) => [name, values]),
  );
  assert.deepEqual(directives["default-src"], ["'self'"]);
  assert.deepEqual(directives["connect-src"], [API_ORIGIN]);
  for (const [name, values] of Object.entries(directives)) {
    for (const value of values) {
      assert.ok(!/unsafe|\*|^http:|^data:|^blob:/.test(value), `${name} ${value}`);
      if (/^https:/.test(value)) assert.equal(value, API_ORIGIN);
    }
  }
});

test("index.html: 인라인 스크립트·style·외부 자원 없음, manifest와 탭 다섯 개", () => {
  const html = read("../web/index.html");
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "인라인 이벤트 처리기 금지");
  assert.doesNotMatch(html, /javascript:/i);

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type="module"/);
  assert.match(scripts[0][1], /src="assets\/app\.js"/);
  assert.equal(scripts[0][2].trim(), "", "인라인 스크립트 금지");

  for (const [, attr, value] of html.matchAll(/\s(src|href)="([^"]*)"/gi)) {
    assert.ok(!/^(?:[a-z]+:)?\/\//i.test(value), `${attr}=${value} 외부 자원 금지`);
  }
  // 주소는 CSP의 API 주소 한 곳에만 나온다.
  assert.deepEqual([...html.matchAll(/https?:\/\/[^\s"';]+/g)].map((m) => m[0]), [API_ORIGIN]);

  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<html lang="ko">/);
  assert.match(html, /name="viewport"/);
  assert.deepEqual(
    [...html.matchAll(/<a class="tab" href="(#\/[a-z]+)" data-tab="([a-z]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2], m[3]]),
    [
      ["#/home", "home", "홈"],
      ["#/aio", "aio", "아이오"],
      ["#/graduation", "graduation", "졸업"],
      ["#/calendar", "calendar", "일정"],
      ["#/more", "more", "더보기"],
    ],
  );
  for (const route of ["home", "aio", "graduation", "calendar", "more"]) {
    assert.match(html, new RegExp(`data-view="${route}"`));
    assert.match(html, new RegExp(`id="title-${route}"`));
  }
  assert.match(html, /id="home-root"/);
  // 해시 라우팅과 부딪히는 문서 안 앵커(#main 등)를 두지 않는다.
  for (const [, value] of html.matchAll(/\shref="(#[^"]*)"/g)) assert.match(value, /^#\/[a-z]+$/);
  assert.ok(!/테크모|금오AI/.test(html));
});

test("app.css: 지정 색, 기기 글꼴, 44px, 포커스, 움직임 줄이기, 외부 자원 없음", () => {
  const css = read("../web/assets/app.css");
  for (const color of ["#0A2540", "#005B96", "#00A3D9", "#FFD100", "#F5F9FC"]) {
    assert.ok(css.toUpperCase().includes(color), color);
  }
  assert.match(css, /--touch:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /font-family:\s*var\(--font-body\)/);
  assert.match(css, /--font-body:\s*Pretendard/);
  assert.doesNotMatch(css, /@import|@font-face|url\(/i);
});
