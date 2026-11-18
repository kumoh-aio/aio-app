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
} from "../web/assets/chat-view.mjs";
import { FAQ, MODE_STORAGE_KEY } from "../web/assets/home.mjs";

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

// 계약 모양의 가짜 기록 저장소: load() -> { sessionId, turns }, save(state) -> boolean, clear() -> boolean
// chat-history처럼 질문 문자열이 message에 없는 차례는 저장하지 않고 버린다. 저장 내용은 load로 돌아온다.
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
        turns: state.turns.filter((turn) => typeof turn?.message === "string" && turn.message.trim()),
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
    form: () => root.find((n) => n.tagName === "FORM"),
    input: () => root.find((n) => n.tagName === "TEXTAREA"),
    submit: () => root.find((n) => n.hasAttribute("data-chat-submit")),
    users: () => root.findAll((n) => n.getAttribute("data-turn") === "user"),
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
  assert.deepEqual(history.calls.saved.at(-1).turns.map((t) => t.message), ["둘째 질문"]);
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
  assert.deepEqual(saved.turns.map((t) => t.message), ["가상 하나", "가상 둘", "가상 셋"]);
  assert.ok(saved.turns.every((t) => !("question" in t)));
  assert.deepEqual(history.stored, saved);
  for (const turn of saved.turns) {
    assert.equal("thinking" in turn, false, "생각 원문은 저장하지 않는다");
    assert.equal(turn.status, "done");
    assert.equal(turn.lang, "zh");
  }
  assert.deepEqual(saved.turns.map((t) => t.mode), ["deep", "deep", "deep"]);
  assert.equal(saved.turns[0].thinkingLabel, "3초 동안 생각함");
  assert.equal(saved.turns[2].thinkingLabel, "思考了 2 秒");
  assert.deepEqual(saved.turns[1].citations, []);

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
    assert.equal(restored.part(restoredItems[i], "data-thinking-note").textContent, saved.turns[i].thinkingLabel);
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
  for (const load of [() => { throw new Error("가상 손상"); }, () => null, () => ({ turns: "x" }), () => ({ turns: [null, { question: "" }] })]) {
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
  assert.match(source, /import\s*\{\s*mountChat\s*\}\s*from\s*"\.\/chat-view\.mjs"/);
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
  for (const selector of [".chat-select", ".thinking-summary", ".chip", ".citation-link"]) {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at > 0 && at < focusAt, selector);
    const body = css.slice(at, css.indexOf("}", at));
    assert.match(body, /min-height:\s*var\(--touch\)/, selector);
  }
  // 안내 답은 일반 말풍선: 공통 카드의 그림자와 굵은 왼쪽 강조선을 덮어쓴다
  const guidedAt = css.indexOf('.answer-card[data-guided="true"] {');
  assert.ok(guidedAt > css.indexOf(".answer-card {") && guidedAt > css.indexOf(".card {"), "카드 규칙 뒤에서 덮어쓴다");
  const guided = css.slice(guidedAt, css.indexOf("}", guidedAt));
  assert.match(guided, /box-shadow:\s*none/);
  assert.match(guided, /border:\s*1px solid var\(--color-border\)/);
  assert.match(css, /@keyframes chat-pulse/);
  const reduced = css.indexOf("@media (prefers-reduced-motion: reduce)");
  assert.match(css.slice(reduced, reduced + 200), /animation: none !important/);
});
