import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LANGS,
  DEFAULT_LANG,
  LANG_STORAGE_KEY,
  TEXT,
  readLang,
  saveLang,
  safeSourceUrl,
  thinkingTitle,
  normalizeState,
  mountChat,
  createPrefStorage,
  syncHomeMode,
} from "../web/assets/chat-view.mjs";
import { FAQ, MODE_STORAGE_KEY, mountHome } from "../web/assets/home.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---- 가짜 DOM: chat-view.mjs가 쓰는 만큼만 흉내 낸다. innerHTML은 쓰면 실패한다. ----
class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.open = false;
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
  click() {
    this.dispatch("click");
  }
  // [이름="값"] 모양 선택자만 지원한다.
  querySelector(selector) {
    const match = /^\[([\w-]+)="([^"]*)"\]$/.exec(selector);
    assert.ok(match, `지원하지 않는 선택자: ${selector}`);
    return this.find((n) => n !== this && n.getAttribute(match[1]) === match[2]);
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

// v2 계약 모양의 가짜 기록 저장소: load() -> { sessionId, turns: [{ selectedVersion, versions }] },
// save(state) -> boolean, clear() -> boolean. chat-history처럼 질문 문자열이 message에 없는 버전과
// 버전이 하나도 남지 않은 차례는 버린다. 저장 내용은 load로 돌아온다.
function fakeHistory({ initial = { sessionId: null, turns: [] }, saveResult = true, clearResult = true, load } = {}) {
  const calls = { saved: [], cleared: 0 };
  let stored = structuredClone(initial);
  return {
    calls,
    get stored() {
      return stored;
    },
    load: load ?? (() => structuredClone(stored)),
    save(state) {
      const kept = {
        sessionId: state.sessionId ?? null,
        turns: state.turns.map((turn) => ({
          selectedVersion: turn?.selectedVersion,
          versions: (Array.isArray(turn?.versions) ? turn.versions : [])
            .filter((version) => typeof version?.message === "string" && version.message.trim()),
        })).filter((turn) => turn.versions.length > 0),
      };
      calls.saved.push(structuredClone(kept));
      if (saveResult) stored = structuredClone(kept);
      return saveResult;
    },
    clear() {
      calls.cleared += 1;
      if (clearResult) stored = { sessionId: null, turns: [] };
      return clearResult;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// 명백히 가상인 근거와 답
const CITE_OK = { document: "가상 학칙", article: "제0조(가상)", snippet: "가상 인용 문장", effectiveDate: "2000-01-01", url: "https://example.invalid/rule" };
const CITE_HTTP = { document: "가상 규정", article: "제1조", snippet: "http 링크", effectiveDate: "", url: "http://example.invalid/x" };
const CITE_JS = { document: "<img src=x onerror=alert(1)>", article: "제2조", snippet: "스크립트 링크", effectiveDate: "", url: "javascript:alert(1)" };

function doneState(extra = {}) {
  return {
    status: "done",
    answer: "가상 답변입니다.",
    thinking: "가상 생각 과정",
    thinkingLabel: "",
    citations: [CITE_OK],
    notice: "",
    answered: true,
    guided: false,
    sessionId: "virtual-session",
    latencyMs: 3200,
    error: null,
    ...extra,
  };
}

// 가짜 send: 호출을 기록하고 정해 둔 갱신을 흘린 뒤 결과를 돌려준다.
function fakeSend(script = () => doneState()) {
  const calls = [];
  const send = async (request) => {
    calls.push(request);
    return script(request, calls.length);
  };
  return { send, calls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function mount({ storage = fakeStorage(), send = fakeSend().send, history = fakeHistory() } = {}) {
  const doc = fakeDocument();
  const root = doc.createElement("div");
  const chat = mountChat({ root, doc, storage, send, history });
  const q = {
    lang: () => root.find((n) => n.hasAttribute("data-lang")),
    mode: (value) => root.find((n) => n.getAttribute("data-mode") === value),
    clear: () => root.find((n) => n.hasAttribute("data-chat-clear")),
    empty: () => root.find((n) => n.hasAttribute("data-chat-empty")),
    status: () => root.find((n) => n.hasAttribute("data-chat-status")),
    chips: () => root.findAll((n) => n.hasAttribute("data-chip")),
    form: () => root.find((n) => n.tagName === "FORM" && !n.hasAttribute("data-edit-form")),
    input: () => root.find((n) => n.getAttribute("id") === "chat-input"),
    submit: () => root.find((n) => n.hasAttribute("data-chat-submit")),
    users: () => root.findAll((n) => n.hasAttribute("data-question")),
    userItems: () => root.findAll((n) => n.getAttribute("data-turn") === "user"),
    cards: () => root.findAll((n) => n.hasAttribute("data-answer")),
    items: () => root.findAll((n) => n.getAttribute("data-turn") === "aio"),
  };
  const part = (item, attr) => item.find((n) => n.hasAttribute(attr));
  return { doc, root, chat, storage, history, q, part };
}

// ---- 순수 함수 ----

test("언어는 ko·en·zh, 기본 ko, 잘못된 값·저장 오류는 ko", () => {
  assert.deepEqual([...LANGS], ["ko", "en", "zh"]);
  assert.equal(DEFAULT_LANG, "ko");
  assert.equal(readLang(fakeStorage()), "ko");
  assert.equal(readLang(fakeStorage({ [LANG_STORAGE_KEY]: "zh" })), "zh");
  assert.equal(readLang(fakeStorage({ [LANG_STORAGE_KEY]: "fr" })), "ko");
  assert.equal(readLang(null), "ko");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(readLang(broken), "ko");
  assert.doesNotThrow(() => saveLang(broken, "en"));
  assert.throws(() => saveLang(fakeStorage(), "fr"), RangeError);
});

test("safeSourceUrl은 https만 남긴다", () => {
  assert.equal(safeSourceUrl("https://example.invalid/a"), "https://example.invalid/a");
  for (const bad of ["http://example.invalid/a", "javascript:alert(1)", "data:text/html,x", "https://exa mple.invalid", "", null, 3]) {
    assert.equal(safeSourceUrl(bad), null, String(bad));
  }
});

test("thinkingTitle은 서버 label을 보존하고 없으면 N초 동안 생각함", () => {
  assert.equal(thinkingTitle({ thinkingLabel: "Thought for 3 seconds" }), "Thought for 3 seconds");
  assert.equal(thinkingTitle({ thinkingLabel: "思考了 3 秒" }), "思考了 3 秒");
  assert.equal(thinkingTitle({ latencyMs: 3200 }), "3초 동안 생각함");
  assert.equal(thinkingTitle({ latencyMs: 100 }), "1초 동안 생각함");
  assert.equal(thinkingTitle({}), TEXT.thinking);
});

test("normalizeState: answered false·guided면 근거를 비우고 url은 https만", () => {
  assert.deepEqual(normalizeState(doneState({ answered: false })).citations, []);
  assert.deepEqual(normalizeState(doneState({ guided: true })).citations, []);
  const state = normalizeState(doneState({ citations: [CITE_OK, CITE_HTTP, CITE_JS, null, "x", {}] }));
  assert.deepEqual(state.citations.map((c) => c.url), ["https://example.invalid/rule", null, null]);
  assert.equal(normalizeState({ status: "weird" }).status, "failed");
});

// ---- 화면 ----

test("빈 화면: 도구 줄, 빈 안내, 추천 칩(홈 FAQ), 입력창 순서", () => {
  const { root, q } = mount();
  assert.equal(q.empty().hidden, false);
  assert.deepEqual(q.chips().map((c) => c.textContent), [...FAQ]);
  assert.equal(q.lang().value, "ko");
  assert.deepEqual(q.lang().children.map((o) => o.getAttribute("value")), ["ko", "en", "zh"]);
  assert.equal(q.mode("fast").getAttribute("aria-pressed"), "true");
  assert.equal(root.children.at(-1).tagName, "FORM", "입력창은 본문 흐름 끝");
  assert.ok(!/테크모|금오AI/.test(root.textContent));
  for (const node of root.walk()) {
    if (node.tagName === "BUTTON") assert.ok(node.getAttribute("type"), "버튼 type 지정");
  }
});

test("홈이 넘긴 같은 질문 객체는 한 번만 실행하고 mode·lang을 전달한다", async () => {
  const { send, calls } = fakeSend();
  const { chat, q } = mount({ send, storage: fakeStorage({ [LANG_STORAGE_KEY]: "en" }) });
  const pending = { question: "  가상 질문  ", mode: "deep" };
  await chat.ask(pending);
  assert.equal(await chat.ask(pending), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].message, "가상 질문");
  assert.equal(calls[0].mode, "deep");
  assert.equal(calls[0].lang, "en");
  assert.equal(calls[0].sessionId, null);
  assert.ok(calls[0].signal instanceof AbortSignal);
  assert.equal(typeof calls[0].onUpdate, "function");
  assert.equal(q.mode("deep").getAttribute("aria-pressed"), "true");

  await chat.ask({ question: "가상 질문", mode: "fast" }); // 다른 객체는 새로 실행
  assert.equal(calls.length, 2);
  assert.equal(calls[1].sessionId, "virtual-session", "서버가 준 세션을 이어 쓴다");
  assert.equal(await chat.ask(null), null);
  assert.equal(await chat.ask({ question: "   " }), null);
  assert.equal(calls.length, 2);
});

for (const mode of ["fast", "deep"]) {
  for (const lang of ["ko", "en", "zh"]) {
    test(`입력창 전송은 고른 ${mode}·${lang}을 그대로 보낸다`, async () => {
      const { send, calls } = fakeSend();
      const storage = fakeStorage();
      const { q, chat } = mount({ send, storage });
      q.mode(mode).dispatch("click");
      q.lang().value = lang;
      q.lang().dispatch("change");
      assert.equal(storage.data.get(LANG_STORAGE_KEY), lang);
      assert.equal(storage.data.get(MODE_STORAGE_KEY), mode);
      q.input().value = "가상 질문";
      const event = q.form().dispatch("submit");
      assert.ok(event.defaultPrevented);
      assert.equal(chat.busy, true);
      await tick();
      assert.deepEqual([calls[0].mode, calls[0].lang], [mode, lang]);
      assert.equal(q.input().value, "");
    });
  }
}

test("빈 질문 전송은 막고 안내한다", () => {
  const { send, calls } = fakeSend();
  const { q, doc } = mount({ send });
  q.input().value = "  ";
  q.form().dispatch("submit");
  assert.equal(calls.length, 0);
  assert.equal(q.input().getAttribute("aria-invalid"), "true");
  assert.equal(doc.activeElement, q.input());
});

test("잘못된 언어 값은 저장하지 않고 되돌린다", () => {
  const storage = fakeStorage();
  const { q } = mount({ storage });
  q.lang().value = "fr";
  q.lang().dispatch("change");
  assert.equal(q.lang().value, "ko");
  assert.equal(storage.data.has(LANG_STORAGE_KEY), false);
});

test("응답 중 갱신: 답이 쌓이고 교체되며 생각 과정은 기본 접힘, 연 상태는 유지", async () => {
  const gate = deferred();
  let update;
  const send = async (request) => {
    update = request.onUpdate;
    await gate.promise;
    return doneState({ answer: "교체된 최종 답", thinkingLabel: "Thought for 3 seconds" });
  };
  const { chat, q, part } = mount({ send });
  const done = chat.ask({ question: "가상 질문", mode: "deep" });
  const [item] = q.items();
  const card = q.cards()[0];
  assert.equal(card.getAttribute("data-status"), "streaming");
  assert.equal(card.getAttribute("aria-busy"), "true");
  assert.equal(part(item, "data-answer-status").textContent, TEXT.streaming);
  assert.equal(q.submit().disabled, true);
  assert.ok(q.chips().every((c) => c.disabled));

  update({ status: "streaming", answer: "", thinking: "가상 생각", thinkingLabel: "" });
  const details = part(item, "data-thinking");
  assert.equal(details.tagName, "DETAILS");
  assert.equal(details.hidden, false);
  assert.equal(details.open, false, "기본 접힘");
  assert.equal(details.hasAttribute("open"), false);
  details.open = true; // 사용자가 펼침

  update({ status: "streaming", answer: "가상 답", thinking: "가상 생각", citations: [] });
  update({ status: "streaming", answer: "가상 답 이어짐", thinking: "가상 생각", citations: [] });
  assert.equal(part(item, "data-answer-body").textContent, "가상 답 이어짐");
  assert.equal(details, part(item, "data-thinking"), "카드는 다시 만들지 않는다");
  assert.equal(details.open, true);

  gate.resolve();
  await done;
  assert.equal(part(item, "data-answer-body").textContent, "교체된 최종 답");
  assert.equal(details.children[0].textContent, "Thought for 3 seconds");
  assert.equal(card.getAttribute("data-status"), "done");
  assert.equal(card.getAttribute("aria-busy"), "false");
  assert.equal(part(item, "data-answer-status").hidden, true);
  assert.equal(q.submit().disabled, false);
});

test("근거 조문 카드: 문서명·조문·시행일·인용, 원문 보기는 https일 때만 noopener", async () => {
  const send = async () => doneState({ citations: [CITE_OK, CITE_HTTP, CITE_JS] });
  const { chat, root } = mount({ send });
  await chat.ask({ question: "가상 질문" });
  const cards = root.findAll((n) => n.hasAttribute("data-citation"));
  assert.equal(cards.length, 3);
  assert.equal(cards[0].children[0].textContent, "가상 학칙 · 제0조(가상) · 2000-01-01");
  assert.equal(cards[0].children[1].tagName, "BLOCKQUOTE");
  assert.equal(cards[0].children[1].textContent, "가상 인용 문장");
  const links = root.findAll((n) => n.tagName === "A");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "https://example.invalid/rule");
  assert.equal(links[0].getAttribute("target"), "_blank");
  assert.equal(links[0].getAttribute("rel"), "noopener noreferrer");
  assert.equal(links[0].textContent, TEXT.source);
  assert.equal(cards[2].children[0].textContent, "<img src=x onerror=alert(1)> · 제2조");
  assert.ok(!root.find((n) => n.tagName === "IMG"));
});

test("안내(notice)와 보류(answered:false)는 근거 없이 안내만, guided는 일반 말풍선", async () => {
  const queue = [
    doneState({ answer: "", notice: "가상 안내 문구", answered: false, citations: [CITE_OK] }),
    doneState({ answer: "가상 안내 답", guided: true, citations: [CITE_OK] }),
  ];
  const { chat, q, part, root } = mount({ send: async () => queue.shift() });
  await chat.ask({ question: "가상 질문 하나" });
  await chat.ask({ question: "가상 질문 둘" });
  const [held, guided] = q.items();
  assert.equal(part(held, "data-notice").textContent, "가상 안내 문구");
  assert.equal(part(held, "data-notice").hidden, false);
  assert.equal(part(held, "data-answer-body").hidden, true);
  assert.equal(part(held, "data-citations").hidden, true);
  assert.equal(part(guided, "data-answer").getAttribute("data-guided"), "true");
  assert.equal(part(guided, "data-citations").hidden, true);
  assert.equal(root.findAll((n) => n.hasAttribute("data-citation")).length, 0);
});

test("다시 받는 중 → 실패 상태와 다시 묻기, 실패는 저장하지 않는다", async () => {
  const gate = deferred();
  let update;
  let attempt = 0;
  const send = async (request) => {
    attempt += 1;
    if (attempt > 1) return doneState();
    update = request.onUpdate;
    await gate.promise;
    return { status: "failed", answer: "", citations: [], error: "가상 오류" };
  };
  const history = fakeHistory();
  const { chat, q, part } = mount({ send, history });
  const done = chat.ask({ question: "가상 질문" });
  update({ status: "fallback", answer: "" });
  const [item] = q.items();
  assert.equal(part(item, "data-answer-status").textContent, TEXT.fallback);
  assert.equal(q.status().textContent, TEXT.fallback);
  gate.resolve();
  await done;
  assert.equal(part(item, "data-answer").getAttribute("data-status"), "failed");
  assert.equal(part(item, "data-answer-status").textContent, TEXT.failed);
  const retry = part(item, "data-retry");
  assert.equal(retry.hidden, false);
  assert.equal(history.calls.saved.length, 0);

  retry.dispatch("click");
  await tick();
  assert.equal(q.items().length, 1, "실패한 차례를 새 시도로 바꾼다");
  assert.equal(q.cards()[0].getAttribute("data-status"), "done");
  assert.equal(history.calls.saved.length, 1);
});

test("send가 던져도 실패로 끝난다", async () => {
  const { chat, q } = mount({ send: async () => { throw new Error("가상 예외"); } });
  const state = await chat.ask({ question: "가상 질문" });
  assert.equal(state.status, "failed");
  assert.equal(q.cards()[0].getAttribute("data-status"), "failed");
  assert.equal(chat.busy, false);
});

test("새 질문이 오면 앞선 요청을 취소하고 늦은 갱신은 버린다", async () => {
  const gate = deferred();
  const requests = [];
  const send = async (request) => {
    requests.push(request);
    if (requests.length === 1) {
      await gate.promise;
      request.onUpdate({ status: "streaming", answer: "늦은 갱신" });
      return doneState({ answer: "늦은 답" });
    }
    return doneState({ answer: "새 답" });
  };
  const history = fakeHistory();
  const { chat, q, part } = mount({ send, history });
  const first = chat.ask({ question: "첫 질문" });
  await chat.ask({ question: "둘째 질문" });
  assert.equal(requests[0].signal.aborted, true);
  gate.resolve();
  await first;
  const [firstItem, secondItem] = q.items();
  assert.notEqual(part(firstItem, "data-answer-body").textContent, "늦은 답");
  assert.equal(part(firstItem, "data-answer").getAttribute("data-status"), "failed", "취소한 차례는 응답 중으로 남지 않는다");
  assert.equal(part(firstItem, "data-retry").hidden, false);
  assert.equal(part(secondItem, "data-answer-body").textContent, "새 답");
  assert.deepEqual(history.calls.saved.at(-1).turns.map((t) => t.versions[t.selectedVersion].message), ["둘째 질문"]);
});

test("완료된 대화만 생각 원문 없이 저장하고, 복원 화면은 실시간 화면과 같다", async () => {
  const history = fakeHistory();
  const queue = [
    doneState({ citations: [CITE_OK, CITE_JS] }),
    doneState({ answer: "", notice: "가상 보류 안내", answered: false }),
    doneState({ answer: "가상 안내", guided: true, thinkingLabel: "思考了 2 秒" }),
  ];
  const live = mount({ send: async () => queue.shift(), history, storage: fakeStorage({ [LANG_STORAGE_KEY]: "zh" }) });
  await live.chat.ask({ question: "가상 하나", mode: "deep" });
  await live.chat.ask({ question: "가상 둘" });
  await live.chat.ask({ question: "가상 셋" });

  const saved = history.calls.saved.at(-1);
  assert.equal(saved.sessionId, "virtual-session");
  assert.equal(saved.turns.length, 3, "질문은 계약대로 message에 담겨 버려지지 않는다");
  assert.deepEqual(saved.turns.map((t) => [t.selectedVersion, t.versions.length]), [[0, 1], [0, 1], [0, 1]]);
  const versions = saved.turns.map((t) => t.versions[0]);
  assert.deepEqual(versions.map((t) => t.message), ["가상 하나", "가상 둘", "가상 셋"]);
  assert.ok(versions.every((t) => !("question" in t)));
  assert.deepEqual(history.stored, saved);
  for (const version of versions) {
    assert.equal("thinking" in version, false, "생각 원문은 저장하지 않는다");
    assert.equal(version.status, "done");
    assert.equal(version.lang, "zh");
    assert.equal(version.sessionId, "virtual-session");
    assert.deepEqual(Object.keys(version).sort(), ["answer", "answered", "citations", "guided", "lang", "latencyMs",
      "message", "mode", "notice", "sessionId", "status", "thinkingLabel"]);
  }
  assert.deepEqual(versions.map((t) => t.mode), ["deep", "deep", "deep"]);
  assert.equal(versions[0].thinkingLabel, "3초 동안 생각함");
  assert.equal(versions[2].thinkingLabel, "思考了 2 秒");
  assert.deepEqual(versions[1].citations, []);

  // 같은 기록 저장소로 앱을 다시 연다
  const restored = mount({ history });
  assert.equal(restored.q.empty().hidden, true);
  assert.equal(restored.q.status().textContent, TEXT.restored);
  const strip = (item, p) => {
    const view = {};
    for (const attr of ["data-answer-body", "data-notice", "data-citations"]) {
      const node = p(item, attr);
      view[attr] = [node.hidden, node.textContent];
    }
    view.guided = p(item, "data-answer").getAttribute("data-guided");
    view.links = item.findAll((n) => n.tagName === "A").map((a) => [a.getAttribute("href"), a.getAttribute("rel")]);
    return view;
  };
  const liveItems = live.q.items();
  const restoredItems = restored.q.items();
  assert.equal(restoredItems.length, 3);
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(strip(restoredItems[i], restored.part), strip(liveItems[i], live.part), `차례 ${i}`);
    const details = restored.part(restoredItems[i], "data-thinking");
    assert.equal(details.hidden, true, "복원 기록에는 생각 원문이 없다");
    assert.equal(restored.part(restoredItems[i], "data-thinking-note").textContent, versions[i].thinkingLabel);
  }
  assert.deepEqual(restored.q.users().map((u) => u.textContent), ["가상 하나", "가상 둘", "가상 셋"]);
});

test("복원 기록은 요청 본문에 넣지 않고 세션만 잇는다", async () => {
  const { send, calls } = fakeSend();
  const initial = { sessionId: "virtual-old", turns: [{ question: "옛 가상 질문", answer: "옛 가상 답", citations: [] }] };
  const { chat } = mount({ send, history: fakeHistory({ initial }) });
  await chat.ask({ question: "새 가상 질문" });
  assert.deepEqual(Object.keys(calls[0]).sort(), ["lang", "message", "mode", "onUpdate", "sessionId", "signal"]);
  assert.equal(calls[0].message, "새 가상 질문");
  assert.equal(calls[0].sessionId, "virtual-old");
});

test("손상된 기록·불러오기 예외는 빈 화면으로 시작한다", () => {
  for (const load of [() => { throw new Error("가상 손상"); }, () => null, () => ({ turns: "x" }), () => ({ turns: [null, { question: "" }] }),
    () => ({ turns: [{ selectedVersion: 0, versions: [] }, { selectedVersion: 0, versions: [null, { message: "  " }] }] })]) {
    const { q } = mount({ history: fakeHistory({ load }) });
    assert.equal(q.empty().hidden, false);
    assert.equal(q.items().length, 0);
  }
});

test("저장이 거부되면 화면에 알리고 대화는 남긴다", async () => {
  const { chat, q } = mount({ history: fakeHistory({ saveResult: false }) });
  await chat.ask({ question: "가상 질문" });
  assert.equal(q.status().textContent, TEXT.saveFailed);
  assert.equal(q.items().length, 1);

  const throwing = fakeHistory();
  throwing.save = () => { throw new Error("가상 용량 초과"); };
  const other = mount({ history: throwing });
  await other.chat.ask({ question: "가상 질문" });
  assert.equal(other.q.status().textContent, TEXT.saveFailed);
});

test("대화 지우기는 기록을 지우고 진행 중 요청을 취소한다", async () => {
  const gate = deferred();
  const requests = [];
  const send = async (request) => {
    requests.push(request);
    await gate.promise;
    return doneState();
  };
  const history = fakeHistory();
  const { chat, q } = mount({ send, history });
  const pending = chat.ask({ question: "가상 질문" });
  q.clear().dispatch("click");
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(history.calls.cleared, 1);
  assert.equal(q.items().length, 0);
  assert.equal(q.empty().hidden, false);
  assert.equal(chat.busy, false);
  gate.resolve();
  await pending;
  assert.equal(q.items().length, 0, "지운 뒤 늦은 답은 그리지 않는다");
  assert.equal(history.calls.saved.length, 0);
});

test("옛 question 키로 저장된 기록도 복원한다", () => {
  const initial = { sessionId: null, turns: [
    { message: "가상 새 키", answer: "가상 답 하나", citations: [] },
    { question: "가상 옛 키", answer: "가상 답 둘", citations: [] },
  ] };
  const { q } = mount({ history: fakeHistory({ initial }) });
  assert.deepEqual(q.users().map((u) => u.textContent), ["가상 새 키", "가상 옛 키"]);
});

test("기록 삭제가 실패하면 빈 기록으로 덮어쓰고, 그것도 막히면 화면을 지우지 않고 알린다", async () => {
  // 삭제만 실패: 빈 기록 덮어쓰기로 지우고, 다시 열어도 돌아오지 않는다
  const history = fakeHistory({ clearResult: false });
  const first = mount({ history });
  await first.chat.ask({ question: "가상 질문" });
  assert.equal(history.stored.turns.length, 1);
  first.q.clear().dispatch("click");
  assert.equal(history.calls.cleared, 1);
  assert.equal(first.q.items().length, 0);
  assert.equal(mount({ history }).q.items().length, 0, "다시 열어도 지운 대화가 없다");

  // 삭제와 덮어쓰기가 모두 실패: 화면은 그대로 두고 알린다
  const stuck = fakeHistory({ clearResult: false, initial: { sessionId: null, turns: [{ message: "가상 남은 질문", answer: "가상 답" }] } });
  stuck.save = () => false;
  const second = mount({ history: stuck });
  second.q.clear().dispatch("click");
  assert.equal(second.q.items().length, 1);
  assert.equal(second.q.status().textContent, TEXT.clearFailed);
  assert.equal(mount({ history: stuck }).q.items().length, 1, "남은 기록과 화면이 일치한다");

  // 예외도 실패로 본다
  const throwing = fakeHistory();
  throwing.clear = () => { throw new Error("가상 접근 거부"); };
  throwing.save = () => { throw new Error("가상 접근 거부"); };
  const third = mount({ history: throwing });
  third.q.clear().dispatch("click");
  assert.equal(third.q.status().textContent, TEXT.clearFailed);
});

test("홈과 아이오가 같은 저장 모드를 따른다: 아이오에서 바꾼 모드가 홈 질문에 이긴다", async () => {
  const { send, calls } = fakeSend();
  const storage = fakeStorage();
  const { chat, q } = mount({ send, storage });
  q.mode("deep").dispatch("click"); // 아이오에서 깊이 생각
  assert.equal(storage.data.get(MODE_STORAGE_KEY), "deep");
  await chat.ask({ question: "가상 질문", mode: "fast" }); // 홈은 처음 읽은 fast를 들고 있다
  assert.equal(calls[0].mode, "deep");
  assert.equal(q.mode("deep").getAttribute("aria-pressed"), "true");

  storage.setItem(MODE_STORAGE_KEY, "fast"); // 홈에서 빠르게로 바꿈
  chat.refresh();
  assert.equal(q.mode("fast").getAttribute("aria-pressed"), "true");
  q.input().value = "가상 질문 둘";
  q.form().dispatch("submit");
  await tick();
  assert.equal(calls[1].mode, "fast");

  // 저장소가 없으면 홈이 넘긴 값을 쓴다
  const bare = fakeSend();
  const noStore = mount({ send: bare.send, storage: null });
  await noStore.chat.ask({ question: "가상 질문", mode: "deep" });
  assert.equal(bare.calls[0].mode, "deep");
});

// 읽기는 되고 쓰기만 막힌 저장소(예: 용량 초과). 예전 값이 그대로 남는다.
function writeBlockedStorage(initial = {}) {
  const storage = fakeStorage(initial);
  storage.setItem = () => { throw new Error("가상 쓰기 거부"); };
  return storage;
}

test("쓰기만 막혀 예전 모드가 남아도 아이오에서 고른 모드로 보낸다", async () => {
  const { send, calls } = fakeSend();
  const storage = writeBlockedStorage({ [MODE_STORAGE_KEY]: "fast" });
  const { chat, q } = mount({ send, storage });
  q.mode("deep").dispatch("click");
  q.input().value = "가상 질문";
  q.form().dispatch("submit");
  await tick();
  assert.equal(calls[0].mode, "deep");
  chat.refresh();
  assert.equal(q.mode("deep").getAttribute("aria-pressed"), "true");
  q.chips()[0].dispatch("click");
  await tick();
  assert.equal(calls[1].mode, "deep");

  // 저장값이 아예 없고 쓰기도 막혔을 때: 여기서 고른 값이 홈이 들고 온 옛 값에 지지 않는다
  const bare = fakeSend();
  const empty = mount({ send: bare.send, storage: writeBlockedStorage() });
  empty.q.mode("deep").dispatch("click");
  await empty.chat.ask({ question: "가상 질문", mode: "fast" });
  assert.equal(bare.calls[0].mode, "deep");
});

test("createPrefStorage: 모드·언어는 메모리에 먼저 남기고 쓰기 오류는 그대로 알린다", () => {
  const real = writeBlockedStorage({ [MODE_STORAGE_KEY]: "fast", other: "가상" });
  const prefs = createPrefStorage(real);
  assert.equal(prefs.getItem(MODE_STORAGE_KEY), "fast");
  assert.throws(() => prefs.setItem(MODE_STORAGE_KEY, "deep"), /가상 쓰기 거부/);
  assert.equal(prefs.getItem(MODE_STORAGE_KEY), "deep", "쓰기가 막혀도 두 화면이 같은 값을 본다");
  assert.throws(() => prefs.setItem("other", "x"));
  assert.equal(prefs.getItem("other"), "가상", "설정 키가 아니면 감싸지 않는다");

  const none = createPrefStorage(null);
  assert.equal(none.getItem(LANG_STORAGE_KEY), null);
  assert.doesNotThrow(() => none.setItem(LANG_STORAGE_KEY, "en"));
  assert.equal(none.getItem(LANG_STORAGE_KEY), "en");
  assert.throws(() => none.setItem("other", "x"));
});

for (const [name, real] of [["정상 저장소", () => fakeStorage()], ["쓰기 막힌 저장소", () => writeBlockedStorage({ [MODE_STORAGE_KEY]: "fast" })]]) {
  test(`홈 복귀 시 아이오에서 바꾼 모드를 홈 표시와 전송에 반영한다(${name})`, async () => {
    const doc = fakeDocument();
    const prefs = createPrefStorage(real());
    const homeRoot = doc.createElement("div");
    const moves = [];
    const home = mountHome({ root: homeRoot, doc, storage: prefs, loadCampusGuide: async () => [], navigate: (route, state) => moves.push(state) });
    await home.ready;
    const { send, calls } = fakeSend();
    const chatRoot = doc.createElement("div");
    const chat = mountChat({ root: chatRoot, doc, storage: prefs, send, history: fakeHistory() });
    const homeButton = (value) => homeRoot.find((n) => n.getAttribute("data-mode") === value);
    assert.equal(home.mode, "fast");

    chatRoot.find((n) => n.getAttribute("data-mode") === "deep").dispatch("click"); // 아이오에서 깊이 생각
    assert.equal(syncHomeMode({ home, root: homeRoot, storage: prefs }), true); // 홈으로 돌아옴
    assert.equal(home.mode, "deep");
    assert.equal(homeButton("deep").getAttribute("aria-pressed"), "true");
    assert.equal(homeButton("fast").getAttribute("aria-pressed"), "false");
    assert.equal(syncHomeMode({ home, root: homeRoot, storage: prefs }), false, "이미 같으면 건드리지 않는다");

    homeRoot.find((n) => n.hasAttribute("data-faq")).dispatch("click"); // 홈에서 질문
    assert.equal(moves.at(-1).mode, "deep");
    await chat.ask(moves.at(-1));
    assert.equal(calls[0].mode, "deep");

    homeButton("fast").dispatch("click"); // 홈에서 다시 빠르게
    chat.refresh();
    assert.equal(chatRoot.find((n) => n.getAttribute("data-mode") === "fast").getAttribute("aria-pressed"), "true");
  });
}

test("syncHomeMode는 홈이나 저장값이 없으면 아무것도 하지 않는다", () => {
  assert.equal(syncHomeMode({ home: null, root: null, storage: fakeStorage({ [MODE_STORAGE_KEY]: "deep" }) }), false);
  assert.equal(syncHomeMode({ home: { mode: "fast" }, root: null, storage: fakeStorage() }), false);
});

test("추천 칩은 현재 모드·언어로 질문한다", async () => {
  const { send, calls } = fakeSend();
  const { q } = mount({ send, storage: fakeStorage({ [MODE_STORAGE_KEY]: "deep", [LANG_STORAGE_KEY]: "en" }) });
  q.chips()[0].dispatch("click");
  await tick();
  assert.deepEqual([calls[0].message, calls[0].mode, calls[0].lang], [FAQ[0], "deep", "en"]);
});

test("필수 주입값이 없으면 예외", () => {
  const doc = fakeDocument();
  assert.throws(() => mountChat({ root: doc.createElement("div"), doc, history: fakeHistory() }), TypeError);
  assert.throws(() => mountChat({ root: doc.createElement("div"), doc, send: async () => ({}) }), TypeError);
});

// ---- 수정·다시 답하기와 버전 넘기기 ----

// 기록 v2 모양의 가상 버전
function version(message, answer, extra = {}) {
  return { message, mode: "fast", lang: "ko", status: "done", answer, thinkingLabel: "", citations: [], notice: "",
    answered: true, guided: false, sessionId: "virtual-session", latencyMs: null, ...extra };
}

function controls(item, part) {
  return {
    edit: part(item, "data-edit"),
    form: part(item, "data-edit-form"),
    input: part(item, "data-edit-input"),
    cancel: part(item, "data-edit-cancel"),
    submit: part(item, "data-edit-submit"),
    nav: part(item, "data-versions"),
    prev: part(item, "data-version-prev"),
    next: part(item, "data-version-next"),
    label: part(item, "data-version-label"),
  };
}

test("질문 수정은 같은 차례를 2/2로 만들고, 이전 버전 1/2는 질문·답·근거를 함께 되돌리며 다시 열어도 유지된다", async () => {
  const queue = [
    doneState({ answer: "가상 첫 답", citations: [CITE_OK] }),
    doneState({ answer: "가상 아래 답", citations: [] }),
    doneState({ answer: "가상 고친 답", citations: [] }),
  ];
  const { send, calls } = fakeSend(() => queue.shift());
  const history = fakeHistory();
  const { chat, q, part, root, doc } = mount({ send, history });
  await chat.ask({ question: "가상 첫 질문" });
  await chat.ask({ question: "가상 아래 질문" });

  const [first] = q.userItems();
  const c = controls(first, part);
  assert.equal(c.edit.hidden, false);
  assert.equal(c.nav.hidden, true, "버전이 하나면 넘기기를 숨긴다");

  c.edit.dispatch("click");
  assert.equal(c.form.hidden, false);
  assert.equal(c.input.value, "가상 첫 질문");
  assert.equal(doc.activeElement, c.input);
  c.input.value = "  가상 고친 질문 ";
  assert.ok(c.form.dispatch("submit").defaultPrevented);
  await tick();

  assert.equal(calls.length, 3);
  assert.equal(calls[2].message, "가상 고친 질문");
  assert.equal(calls[2].sessionId, "virtual-session", "수정 요청도 지금 세션으로 보낸다");
  assert.equal(c.form.hidden, true);
  assert.equal(q.items().length, 2, "차례를 새로 붙이지 않는다");
  assert.deepEqual(q.users().map((u) => u.textContent), ["가상 고친 질문", "가상 아래 질문"]);
  assert.equal(part(q.items()[0], "data-answer-body").textContent, "가상 고친 답");
  assert.equal(part(q.items()[1], "data-answer-body").textContent, "가상 아래 답", "아래 차례는 그대로");
  assert.equal(c.nav.hidden, false);
  assert.equal(c.label.textContent, "2/2");
  assert.equal(c.prev.getAttribute("aria-label"), TEXT.prevVersion);
  assert.equal(c.next.getAttribute("aria-label"), TEXT.nextVersion);
  assert.equal(c.next.disabled, true);
  assert.equal(c.next.getAttribute("aria-disabled"), "true");
  assert.equal(c.prev.disabled, false);
  let saved = history.calls.saved.at(-1);
  assert.deepEqual(saved.turns.map((t) => [t.selectedVersion, t.versions.map((v) => v.message)]),
    [[1, ["가상 첫 질문", "가상 고친 질문"]], [0, ["가상 아래 질문"]]]);

  c.prev.focus();
  c.prev.dispatch("click");
  assert.equal(calls.length, 3, "버전 이동은 요청을 보내지 않는다");
  assert.equal(c.label.textContent, "1/2");
  assert.equal(q.users()[0].textContent, "가상 첫 질문");
  assert.equal(part(q.items()[0], "data-answer-body").textContent, "가상 첫 답");
  assert.equal(root.findAll((n) => n.hasAttribute("data-citation")).length, 1, "당시 근거가 함께 돌아온다");
  assert.equal(c.prev.disabled, true);
  assert.equal(doc.activeElement, c.next, "막힌 버튼에서 반대쪽으로 포커스를 옮긴다");
  saved = history.calls.saved.at(-1);
  assert.equal(saved.turns[0].selectedVersion, 0);

  const again = mount({ history });
  const r = controls(again.q.userItems()[0], again.part);
  assert.equal(r.label.textContent, "1/2");
  assert.equal(again.q.users()[0].textContent, "가상 첫 질문");
  assert.equal(again.part(again.q.items()[0], "data-answer-body").textContent, "가상 첫 답");
  r.next.dispatch("click");
  assert.equal(again.q.users()[0].textContent, "가상 고친 질문");
  assert.equal(history.stored.turns[0].selectedVersion, 1);
});

test("빈 질문으로 고치면 보내지 않고, 취소·Esc는 원래 질문으로 닫는다", async () => {
  const { send, calls } = fakeSend();
  const { chat, q, part, doc } = mount({ send });
  await chat.ask({ question: "가상 질문" });
  const c = controls(q.userItems()[0], part);
  c.edit.dispatch("click");
  c.input.value = "   ";
  c.form.dispatch("submit");
  assert.equal(calls.length, 1);
  assert.equal(c.input.getAttribute("aria-invalid"), "true");
  c.cancel.dispatch("click");
  assert.equal(c.form.hidden, true);
  assert.equal(doc.activeElement, c.edit);
  c.edit.dispatch("click");
  for (const fn of c.input.listeners.get("keydown")) fn({ key: "Escape" });
  assert.equal(c.form.hidden, true);
  assert.equal(q.users()[0].textContent, "가상 질문");
});

test("다시 답하기는 같은 질문으로 새 버전을 쌓고 이전 답으로 되돌릴 수 있다", async () => {
  const queue = [doneState({ answer: "가상 답 하나" }), doneState({ answer: "가상 답 둘", citations: [] })];
  const { send, calls } = fakeSend(() => queue.shift());
  const history = fakeHistory();
  const { chat, q, part } = mount({ send, history });
  await chat.ask({ question: "가상 질문", mode: "deep" });
  const [item] = q.items();
  part(item, "data-regenerate").dispatch("click");
  await tick();
  assert.equal(calls[1].message, "가상 질문");
  const c = controls(q.userItems()[0], part);
  assert.equal(c.label.textContent, "2/2");
  assert.equal(part(item, "data-answer-body").textContent, "가상 답 둘");
  c.prev.dispatch("click");
  assert.equal(part(item, "data-answer-body").textContent, "가상 답 하나");
  assert.equal(history.stored.turns[0].versions.length, 2);
  assert.equal(history.stored.turns[0].selectedVersion, 0);
});

test("답을 받는 동안(스트리밍·대체 응답) 수정·다시 답하기·버전 이동을 막는다", async () => {
  const initial = { sessionId: "virtual-session", turns: [
    { selectedVersion: 1, versions: [version("가상 옛 질문", "가상 옛 답"), version("가상 고친 질문", "가상 고친 답")] },
  ] };
  const gate = deferred();
  let update;
  const calls = [];
  const send = async (request) => {
    calls.push(request);
    update = request.onUpdate;
    await gate.promise;
    return doneState({ answer: "가상 새 답" });
  };
  const { chat, q, part, root } = mount({ send, history: fakeHistory({ initial }) });
  const c = controls(q.userItems()[0], part);
  const regen = part(q.items()[0], "data-regenerate");
  assert.equal(c.label.textContent, "2/2");
  c.edit.dispatch("click"); // 받기 전에 고치기를 열어 둔다
  assert.equal(c.form.hidden, false);

  const done = chat.ask({ question: "가상 새 질문" });
  assert.equal(root.getAttribute("aria-busy"), "true");
  for (const stage of ["streaming", "fallback"]) {
    update({ status: stage, answer: "" });
    for (const button of [c.edit, c.submit, c.prev, regen]) {
      assert.equal(button.disabled, true, `${stage} ${button.getAttribute("data-edit") ?? ""}`);
      assert.equal(button.getAttribute("aria-disabled"), "true");
    }
    // 막힌 버튼을 강제로 눌러도 처리기가 거른다
    c.input.value = "가상 몰래 고친 질문";
    c.form.dispatch("submit");
    c.prev.dispatch("click");
    regen.dispatch("click");
    assert.equal(calls.length, 1);
    assert.equal(c.label.textContent, "2/2");
    assert.equal(q.users()[0].textContent, "가상 고친 질문");
  }
  const streamingCard = q.cards()[1];
  assert.equal(streamingCard.getAttribute("aria-busy"), "true");
  assert.equal(part(q.userItems()[1], "data-edit").hidden, true, "받는 중인 차례는 고칠 수 없다");

  gate.resolve();
  await done;
  assert.equal(root.getAttribute("aria-busy"), "false");
  for (const button of [c.edit, c.submit, c.prev, regen]) {
    assert.equal(button.disabled, false);
    assert.equal(button.hasAttribute("aria-disabled"), false);
  }
  assert.equal(c.next.disabled, true, "마지막 버전에서는 다음이 막혀 있다");
});

test("수정·다시 답하기가 실패하거나 취소되면 직전 완료 버전과 차례 순서가 그대로다", async () => {
  const initial = { sessionId: "virtual-session", turns: [
    { selectedVersion: 0, versions: [version("가상 질문 하나", "가상 답 하나", { citations: [CITE_OK] })] },
    { selectedVersion: 0, versions: [version("가상 질문 둘", "가상 답 둘")] },
  ] };
  const gate = deferred();
  const requests = [];
  const send = async (request) => {
    requests.push(request);
    if (requests.length === 1) return { status: "failed", answer: "", citations: [], error: "가상 오류" };
    if (requests.length === 2) {
      request.onUpdate({ status: "streaming", answer: "가상 중간 답" });
      await gate.promise;
      request.onUpdate({ status: "streaming", answer: "가상 늦은 갱신" });
      return doneState({ answer: "가상 늦은 답" });
    }
    return doneState({ answer: "가상 새 답" });
  };
  const history = fakeHistory({ initial });
  const { chat, q, part } = mount({ send, history });

  // 수정 실패: 고치기 전 질문·답·근거로 돌아간다
  const c = controls(q.userItems()[0], part);
  c.edit.dispatch("click");
  c.input.value = "가상 고친 질문";
  c.form.dispatch("submit");
  await tick();
  const first = q.items()[0];
  assert.equal(q.users()[0].textContent, "가상 질문 하나");
  assert.equal(part(first, "data-answer-body").textContent, "가상 답 하나");
  assert.equal(part(first, "data-answer").getAttribute("data-status"), "done");
  assert.equal(part(first, "data-retry").hidden, true);
  assert.equal(part(first, "data-citations").hidden, false);
  assert.equal(c.nav.hidden, true, "실패한 시도는 버전이 되지 않는다");
  assert.equal(q.status().textContent, TEXT.failed);
  assert.equal(history.calls.saved.length, 0);

  // 다시 답하기 중 새 질문으로 취소: 받던 글자를 걷고 원래 답을 보여 준다. 늦은 갱신은 버린다.
  const second = q.items()[1];
  part(second, "data-regenerate").dispatch("click");
  await tick();
  assert.equal(part(second, "data-answer-body").textContent, "가상 중간 답");
  await chat.ask({ question: "가상 질문 셋" });
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(part(second, "data-answer-body").textContent, "가상 답 둘");
  gate.resolve();
  await tick();
  await tick();
  assert.equal(part(second, "data-answer-body").textContent, "가상 답 둘");
  assert.deepEqual(q.users().map((u) => u.textContent), ["가상 질문 하나", "가상 질문 둘", "가상 질문 셋"]);
  assert.deepEqual(history.stored.turns.map((t) => [t.selectedVersion, t.versions.length]), [[0, 1], [0, 1], [0, 1]]);
});

test("v2 기록 복원: 고른 버전을 지키고, 손상된 버전을 걸러 내면 고른 위치를 다시 맞춘다", () => {
  const initial = { sessionId: null, turns: [
    { selectedVersion: 2, versions: [version("가상 A", "가상 답 A"), { message: "" }, version("가상 C", "가상 답 C")] },
    { selectedVersion: 1, versions: [version("가상 D", "가상 답 D"), null, version("가상 F", "가상 답 F")] },
    { selectedVersion: 9, versions: [version("가상 G", "가상 답 G"), version("가상 H", "가상 답 H")] },
    { selectedVersion: 0, versions: [version("가상 I", "가상 답 I", { mode: "deep", lang: "en" })] },
  ] };
  const { q, part } = mount({ history: fakeHistory({ initial }) });
  assert.deepEqual(q.users().map((u) => u.textContent), ["가상 C", "가상 F", "가상 H", "가상 I"]);
  const labels = q.userItems().map((item) => controls(item, part));
  assert.deepEqual(labels.map((c) => [c.nav.hidden, c.label.textContent]),
    [[false, "2/2"], [false, "2/2"], [false, "2/2"], [true, "1/1"]]);
});

// ---- 정적 파일 검사 ----

test("chat-view.mjs는 innerHTML류와 외부 주소를 쓰지 않고 이름 규칙을 지킨다", () => {
  const source = read("../web/assets/chat-view.mjs");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /테크모|금오AI/);
  for (const [, spec] of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
    assert.match(spec, /^\.\/[\w-]+\.m?js$/, spec);
  }
});

test("app.js는 takePendingAsk 없이 showView에서 chat.ask를 부르고 chat-root에 그린다", () => {
  const source = read("../web/assets/app.js");
  assert.doesNotMatch(source, /takePendingAsk|pendingAsk/);
  assert.match(source, /import\s*\{\s*mountChat,\s*createPrefStorage,\s*syncHomeMode\s*\}\s*from\s*"\.\/chat-view\.mjs"/);
  assert.match(source, /const prefs = createPrefStorage\(storage\)/);
  assert.match(source, /createChatHistory\(\{\s*storage\s*\}\)/, "기록은 원래 저장소를 쓴다");
  assert.equal([...source.matchAll(/storage: prefs/g)].length, 3, "홈·아이오·홈 동기화가 같은 설정 저장소를 쓴다");
  assert.match(source, /if \(route === "home"\) syncHomeMode\(\{ home, root: homeRoot, storage: prefs \}\)/);
  assert.match(source, /import\s*\{\s*createChatClient\s*\}\s*from\s*"\.\/chat-client\.mjs"/);
  assert.match(source, /import\s*\{\s*createChatHistory\s*\}\s*from\s*"\.\/chat-history\.mjs"/);
  assert.match(source, /route === "aio" && state\) chat\.ask\(state\)/);
  assert.match(source, /else if \(route === "aio"\) chat\.refresh\(\)/);
  assert.ok(source.indexOf("mountChat(") < source.indexOf("router.start()"), "라우터보다 먼저 그린다");
  const html = read("../web/index.html");
  assert.match(html, /<section class="view" data-view="aio"[^>]*>\s*<h1 id="title-aio"[^>]*>아이오<\/h1>\s*<div id="chat-root" class="chat"><\/div>/);
});

test("app.css: 채팅 규칙은 포커스 규칙 앞에 있고 터치 영역은 44px 변수", () => {
  const css = read("../web/assets/app.css");
  const focusAt = css.lastIndexOf(":focus-visible");
  for (const selector of [".chat-select", ".thinking-summary", ".chip", ".citation-link", ".version-step", ".chat-edit-input"]) {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at > 0 && at < focusAt, selector);
    const body = css.slice(at, css.indexOf("}", at));
    assert.match(body, /min-height:\s*var\(--touch\)/, selector);
  }
  // 수정·버전 넘기기 버튼은 44px 정사각 이상이고 컨트롤 경계선 토큰을 쓴다
  const stepAt = css.search(/\.turn-action,\s*\.version-step \{/);
  assert.ok(stepAt > 0 && stepAt < focusAt);
  const step = css.slice(stepAt, css.indexOf("}", stepAt));
  assert.match(step, /min-width:\s*var\(--touch\)/);
  assert.match(step, /border:\s*1px solid var\(--color-control-border\)/);
  assert.match(step, /color:\s*var\(--color-school-blue\)/);
  const disabledAt = css.indexOf(".turn-action:disabled");
  assert.ok(disabledAt > stepAt && disabledAt < focusAt);
  assert.doesNotMatch(css.slice(disabledAt, css.indexOf("}", disabledAt)), /opacity/, "막힌 상태도 글자 대비를 지킨다");
  // 안내 답은 일반 말풍선: 공통 카드의 그림자와 굵은 왼쪽 강조선을 덮어쓴다
  const guidedAt = css.indexOf('.answer-card[data-guided="true"] {');
  assert.ok(guidedAt > css.indexOf(".answer-card {") && guidedAt > css.indexOf(".card {"), "카드 규칙 뒤에서 덮어쓴다");
  const guided = css.slice(guidedAt, css.indexOf("}", guidedAt));
  assert.match(guided, /box-shadow:\s*var\(--shadow-guided\)/);
  assert.match(css, /--shadow-guided:\s*none/);
  assert.match(guided, /border:\s*var\(--border-card\)/);
  assert.match(css, /@keyframes chat-pulse/);
  const reduced = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.match(css.slice(reduced, reduced + 200), /animation: none !important/);
});
