import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatHistory } from "../web/assets/chat-history.mjs";

const V1 = "aio.chat.history.v1";
const V2 = "aio.chat.history.v2";
const empty = { sessionId: null, turns: [] };
function fakeStorage() {
  const entries = new Map();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}
function snapshot(overrides = {}) {
  return {
    message: "가상 질문", mode: "deep", lang: "en", answer: "가상 답변",
    thinkingLabel: "완료 상태", citations: [{ document: "가상 문서", article: "가상 조항",
      snippet: "가상 인용", effectiveDate: "2099-01-01", url: "https://example.test/rules" }],
    notice: "가상 안내", answered: true, guided: false, sessionId: "fake-session", latencyMs: 123,
    ...overrides,
  };
}
const turn = (...versions) => ({ selectedVersion: versions.length - 1, versions });
const state = (...turns) => ({ sessionId: "fake-session", turns });
const denied = () => { throw new DOMException("Fake storage unavailable", "SecurityError"); };

test("round trips versions, selected question, answer, citations and metadata without raw thinking", () => {
  const storage = fakeStorage();
  const history = createChatHistory({ storage });
  assert.deepEqual(history.load(), empty);
  const first = snapshot();
  const second = snapshot({ message: "수정한 가상 질문", answer: "새 가상 답변", lang: "zh" });
  const input = state(turn({ ...first, status: "done", thinking: "가상 생각 원문", error: null }, second));
  assert.equal(history.save(input), true);
  assert.deepEqual(history.load(), state(turn(first, second)));
  const saved = JSON.parse(storage.getItem(V2));
  assert.deepEqual(Object.keys(saved.turns[0].versions[0]), Object.keys(first));
  input.turns[0].selectedVersion = 0;
  assert.equal(history.save(input), true);
  assert.equal(createChatHistory({ storage }).load().turns[0].selectedVersion, 0);
  assert.equal(input.turns[0].versions[0].thinking, "가상 생각 원문");
});

test("migrates only completed v1 turns and removes v1 after writing v2", () => {
  const storage = fakeStorage();
  const first = snapshot();
  const old = snapshot();
  delete old.mode;
  delete old.lang;
  storage.setItem(V1, JSON.stringify(state({ ...first, status: "done", thinking: "가상 생각" },
    { ...old, status: "done" }, { ...first, status: "streaming" }, { ...first, status: "failed" })));
  const expected = state(turn(first), turn(snapshot({ mode: "fast", lang: "ko" })));
  assert.deepEqual(createChatHistory({ storage }).load(), expected);
  assert.equal(storage.getItem(V1), null);
  assert.deepEqual(JSON.parse(storage.getItem(V2)), expected);
});

test("rejects flat view saves without overwriting migrated or existing version history", () => {
  const storage = fakeStorage();
  const history = createChatHistory({ storage });
  const legacy = JSON.stringify(state({ ...snapshot(), status: "done" }));
  storage.setItem(V1, legacy);
  const flat = state({ ...snapshot({ message: "새 가상 질문" }), status: "done" });

  assert.equal(history.save(flat), false);
  assert.equal(storage.getItem(V1), legacy);
  assert.equal(storage.getItem(V2), null);

  const migrated = history.load();
  assert.deepEqual(migrated, state(turn(snapshot())));
  const serialized = storage.getItem(V2);
  assert.equal(history.save(flat), false);
  assert.equal(storage.getItem(V2), serialized);
  assert.deepEqual(history.load(), migrated);

  const versioned = turn(snapshot(), snapshot({ message: "수정한 가상 질문" }));
  assert.equal(history.save(state(versioned)), true);
  const withVersions = storage.getItem(V2);
  assert.equal(history.save(state(versioned, flat.turns[0])), false);
  assert.equal(storage.getItem(V2), withVersions);
  assert.deepEqual(history.load(), state(versioned));
});

test("returns all migrated turns and retains v1 when storage fails, even after quota trimming", () => {
  for (const name of ["SecurityError", "QuotaExceededError"]) {
    const storage = fakeStorage();
    const legacy = JSON.stringify(state({ ...snapshot(), status: "done" }, { ...snapshot(), status: "done" }));
    storage.setItem(V1, legacy);
    storage.setItem = () => { throw new DOMException("Fake failure", name); };
    assert.deepEqual(createChatHistory({ storage }).load(), state(turn(snapshot()), turn(snapshot())));
    assert.equal(storage.getItem(V1), legacy);
    assert.equal(storage.getItem(V2), null);
  }
});

test("existing empty or corrupt v2 never revives v1", () => {
  for (const current of ["", "{", "null", "{}", JSON.stringify(empty)]) {
    const storage = fakeStorage();
    storage.setItem(V1, JSON.stringify(state({ ...snapshot(), status: "done" })));
    storage.setItem(V2, current);
    assert.deepEqual(createChatHistory({ storage }).load(), empty);
    assert.equal(storage.getItem(V2), current);
  }
});

test("filters invalid versions, remaps selection and clamps malformed indices", () => {
  const storage = fakeStorage();
  const history = createChatHistory({ storage });
  const a = snapshot();
  const b = snapshot({ message: "두 번째 가상 질문" });
  const versions = [null, a, { ...a, status: "streaming" }, b, { message: 12 }];
  const cases = [[3, 1], [2, 0], [99, 1], [-1, 0], [1.5, 0], ["3", 0]];
  for (const [selectedVersion, expected] of cases) {
    storage.setItem(V2, JSON.stringify(state(null, { versions: [] }, { selectedVersion, versions })));
    assert.deepEqual(history.load(), state({ selectedVersion: expected, versions: [a, b] }));
  }
  assert.equal(history.save(state(turn({ ...a, status: "failed" }, { ...a, status: "fallback" }))), true);
  assert.deepEqual(history.load().turns, []);
});

test("normalizes fields, guidance and citation links and drops unapproved properties", () => {
  const storage = fakeStorage();
  const history = createChatHistory({ storage });
  const citation = { ...snapshot().citations[0], url: "http://example.test/" };
  history.save({ sessionId: 12, turns: [turn(snapshot({ mode: "invalid", lang: "invalid", sessionId: 12,
    latencyMs: Infinity, citations: [null, citation], thinking: "가상 원문" })),
  turn(snapshot({ answered: false })), turn(snapshot({ guided: true }))] });
  const loaded = history.load();
  assert.equal(loaded.sessionId, null);
  const saved = loaded.turns[0].versions[0];
  assert.equal(saved.mode, "fast");
  assert.equal(saved.lang, "ko");
  assert.equal(saved.sessionId, null);
  assert.equal(saved.latencyMs, null);
  assert.equal(Object.hasOwn(saved, "thinking"), false);
  assert.deepEqual(loaded.turns.map((t) => t.versions[0].citations), [[{ ...citation, url: null }], [], []]);
});

test("quota drops whole oldest turns without mutating versions or caller state", () => {
  const storage = fakeStorage();
  const attempts = [];
  const write = storage.setItem;
  let quotaAvailable = true;
  storage.setItem = (key, serialized) => {
    const { turns } = JSON.parse(serialized);
    attempts.push(turns.length);
    if (!quotaAvailable || turns.length > 1) throw new DOMException("Fake quota", "QuotaExceededError");
    write(key, serialized);
  };
  const history = createChatHistory({ storage });
  const input = state(turn(snapshot()), turn(snapshot()), turn(snapshot(), snapshot({ message: "수정 질문" })));
  const before = structuredClone(input);
  assert.equal(history.save(input), true);
  assert.deepEqual(attempts, [3, 2, 1]);
  assert.deepEqual(input, before);
  assert.deepEqual(history.load(), state(input.turns[2]));
  quotaAvailable = false;
  assert.equal(history.save(state(input.turns[0])), false);
  assert.deepEqual(attempts, [3, 2, 1, 1, 0]);
  assert.deepEqual(history.load(), state(input.turns[2]));
});

test("successful v2 stays authoritative when legacy cleanup fails; clear attempts both keys", () => {
  const storage = fakeStorage();
  storage.setItem(V1, JSON.stringify(state({ ...snapshot(), status: "done" })));
  const remove = storage.removeItem;
  storage.removeItem = denied;
  const history = createChatHistory({ storage });
  assert.equal(history.save(empty), true);
  assert.deepEqual(history.load(), empty);
  const attempts = [];
  storage.removeItem = (key) => { attempts.push(key); if (key === V2) denied(); remove(key); };
  assert.equal(history.clear(), false);
  assert.deepEqual(attempts, [V2, V1]);
  assert.equal(storage.getItem(V1), null);
  storage.removeItem = remove;
  storage.setItem(V1, "{}");
  assert.equal(history.clear(), true);
  assert.equal(storage.entries.size, 0);
});

test("handles malformed legacy JSON and blocked storage operations", () => {
  const storage = fakeStorage();
  storage.setItem(V1, "{");
  assert.deepEqual(createChatHistory({ storage }).load(), empty);
  const history = createChatHistory({ storage: { getItem: denied, setItem: denied, removeItem: denied } });
  assert.deepEqual(history.load(), empty);
  assert.equal(history.save(empty), false);
  assert.equal(history.clear(), false);
});
