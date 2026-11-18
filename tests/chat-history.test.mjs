import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatHistory } from "../web/assets/chat-history.mjs";

const empty = { sessionId: null, turns: [] };

function fakeStorage() {
  const entries = new Map();
  return {
    entries,
    getItem(key) {
      return entries.get(key) ?? null;
    },
    setItem(key, value) {
      entries.set(key, value);
    },
    removeItem(key) {
      entries.delete(key);
    },
  };
}

function completedTurn(overrides = {}) {
  return {
    message: "가상 질문",
    status: "done",
    answer: "가상 답변",
    thinking: "가상 생각 원문",
    thinkingLabel: "가상 진행 상태",
    citations: [{
      document: "가상 문서",
      article: "가상 조항",
      snippet: "테스트용 인용",
      effectiveDate: "2099-01-01",
      url: "https://example.test/rules",
    }],
    notice: "",
    answered: true,
    guided: false,
    sessionId: "fake-session",
    latencyMs: 123,
    error: null,
    ...overrides,
  };
}

test("stores and restores only completed turns, with answer, citations and guidance", () => {
  const storage = fakeStorage();
  const answered = completedTurn();
  const guided = completedTurn({
    message: "가상 안내 질문",
    notice: "가상 안내",
    citations: [],
    answered: true,
    guided: true,
  });
  const history = createChatHistory({ storage });
  assert.deepEqual(history.load(), empty);
  assert.equal(history.save({
    sessionId: "fake-session",
    turns: [answered, completedTurn({ status: "streaming" }), guided, completedTurn({ status: "failed" })],
  }), true);

  assert.equal(storage.entries.size, 1);
  const [key, serialized] = [...storage.entries][0];
  assert.match(key, /\.v1$/);
  assert.equal(Object.hasOwn(JSON.parse(serialized).turns[0], "thinking"), false);
  assert.deepEqual(createChatHistory({ storage }).load(), {
    sessionId: "fake-session",
    turns: [{ ...answered, thinking: "" }, { ...guided, thinking: "" }],
  });
  assert.equal(history.clear(), true);
  assert.deepEqual(history.load(), empty);
});

test("recovers from broken JSON and blocked storage", () => {
  const storage = fakeStorage();
  const history = createChatHistory({ storage });
  history.save(empty);
  const [key] = storage.entries.keys();
  storage.setItem(key, "{");
  assert.deepEqual(history.load(), empty);
  assert.equal(history.save(empty), true);

  const denied = () => { throw new DOMException("Fake storage unavailable", "SecurityError"); };
  const blockedHistory = createChatHistory({
    storage: { getItem: denied, setItem: denied, removeItem: denied },
  });
  assert.deepEqual(blockedHistory.load(), empty);
  assert.equal(blockedHistory.save(empty), false);
  assert.equal(blockedHistory.clear(), false);
});

test("drops the oldest turns on quota errors and preserves the caller's history", () => {
  const storage = fakeStorage();
  const attempts = [];
  let quotaAvailable = true;
  const history = createChatHistory({ storage: {
    ...storage,
    setItem(key, serialized) {
      const { turns } = JSON.parse(serialized);
      attempts.push(turns.length);
      if (!quotaAvailable || turns.length > 1) throw new DOMException("Fake quota", "QuotaExceededError");
      storage.setItem(key, serialized);
    },
  } });
  const state = {
    sessionId: "fake-session",
    turns: ["가상 질문 1", "가상 질문 2", "가상 질문 3"].map((message) => completedTurn({ message })),
  };
  assert.equal(history.save(state), true);
  assert.deepEqual(attempts, [3, 2, 1]);
  assert.equal(state.turns.length, 3);
  assert.deepEqual(history.load().turns.map((turn) => turn.message), ["가상 질문 3"]);

  quotaAvailable = false;
  assert.equal(history.save({ ...state, turns: state.turns.slice(0, 1) }), false);
  assert.deepEqual(attempts, [3, 2, 1, 1, 0]);
  assert.deepEqual(history.load().turns.map((turn) => turn.message), ["가상 질문 3"]);
});

test("normalizes malformed saved fields and only restores HTTPS citation links", () => {
  const storage = fakeStorage();
  const history = createChatHistory({ storage });
  history.save(empty);
  const [key] = storage.entries.keys();
  const citation = { ...completedTurn().citations[0], url: "http://example.test/" };
  storage.setItem(key, JSON.stringify({
    sessionId: 12,
    turns: [
      null,
      completedTurn({ citations: [null, citation] }),
      completedTurn({ answered: false }),
      completedTurn({ guided: true }),
    ],
  }));
  const stored = history.load();
  assert.equal(stored.sessionId, null);
  assert.deepEqual(stored.turns.map((turn) => turn.citations), [[{ ...citation, url: null }], [], []]);
});
