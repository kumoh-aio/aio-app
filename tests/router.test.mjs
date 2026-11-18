import { test } from "node:test";
import assert from "node:assert/strict";
import { ROUTES, DEFAULT_ROUTE, parseHash, hashFor, createRouter } from "../web/assets/router.mjs";

// 브라우저처럼 해시가 바뀔 때 hashchange를 부르고 방문 기록을 흉내 내는 가짜 window.
function fakeWindow(initialHash = "") {
  const listeners = new Set();
  const history = [initialHash];
  let index = 0;
  let hash = initialHash;
  const fire = () => {
    for (const fn of [...listeners]) fn({ type: "hashchange" });
  };
  const win = {
    location: {
      get hash() {
        return hash;
      },
      set hash(value) {
        const next = value.startsWith("#") ? value : `#${value}`;
        if (next === hash) return;
        history.splice(index + 1);
        history.push(next);
        index += 1;
        hash = next;
        fire();
      },
      replace(url) {
        const next = url.slice(url.indexOf("#"));
        history[index] = next;
        if (next === hash) return;
        hash = next;
        fire();
      },
    },
    addEventListener(type, fn) {
      if (type === "hashchange") listeners.add(fn);
    },
    removeEventListener(type, fn) {
      if (type === "hashchange") listeners.delete(fn);
    },
    back() {
      if (index === 0) return;
      index -= 1;
      hash = history[index];
      fire();
    },
    history,
  };
  return win;
}

function start(initialHash) {
  const win = fakeWindow(initialHash);
  const seen = [];
  const router = createRouter({ win, onRoute: (change) => seen.push(change) });
  router.start();
  return { win, seen, router };
}

test("탭은 다섯 개이고 기본값은 홈", () => {
  assert.deepEqual([...ROUTES], ["home", "aio", "graduation", "calendar", "more"]);
  assert.equal(DEFAULT_ROUTE, "home");
  assert.ok(Object.isFrozen(ROUTES));
});

test("parseHash는 다섯 해시만 알아본다", () => {
  for (const route of ROUTES) {
    assert.equal(parseHash(`#/${route}`), route);
    assert.equal(parseHash(`#/${route}/`), route);
    assert.equal(hashFor(route), `#/${route}`);
  }
  for (const bad of ["", "#", "#/", "#/HOME", "#/unknown", "#home", "#/aio?q=x", "#/aio/extra", null, undefined]) {
    assert.equal(parseHash(bad), null, String(bad));
  }
  assert.throws(() => hashFor("settings"), RangeError);
});

test("탭마다 해시로 직접 들어갈 수 있다", () => {
  for (const route of ROUTES) {
    const { seen, router } = start(`#/${route}`);
    assert.deepEqual(seen, [{ route, state: null }]);
    assert.equal(router.current, route);
  }
});

test("빈 해시와 모르는 해시는 기록을 남기지 않고 #/home으로 보낸다", () => {
  for (const initial of ["", "#/nope", "#/aio?question=x"]) {
    const { win, seen } = start(initial);
    assert.equal(win.location.hash, "#/home");
    assert.deepEqual(seen, [{ route: "home", state: null }], initial);
    assert.deepEqual(win.history, ["#/home"]);
  }
});

test("탭을 옮긴 뒤 뒤로가기로 이전 탭에 돌아온다", () => {
  const { win, seen } = start("#/home");
  win.location.hash = "#/graduation";
  win.location.hash = "#/calendar";
  win.back();
  win.back();
  assert.deepEqual(
    seen.map((change) => change.route),
    ["home", "graduation", "calendar", "graduation", "home"],
  );
});

test("navigate는 질문을 URL에 넣지 않고 메모리로 한 번만 넘긴다", () => {
  const { win, seen, router } = start("#/home");
  const ask = { question: "가상 질문입니다", mode: "deep" };
  router.navigate("aio", ask);
  assert.equal(win.location.hash, "#/aio");
  assert.ok(!win.history.some((entry) => entry.includes("question") || entry.includes("가상")));
  assert.deepEqual(seen.at(-1), { route: "aio", state: ask });

  // 뒤로 갔다가 앞으로 와도 질문이 다시 전달되지 않는다.
  win.back();
  win.location.hash = "#/aio";
  assert.deepEqual(seen.at(-1), { route: "aio", state: null });
});

test("이미 같은 탭이면 질문이 있을 때만 다시 알린다", () => {
  const { seen, router } = start("#/aio");
  router.navigate("aio");
  assert.equal(seen.length, 1);
  router.navigate("aio", { question: "두 번째 가상 질문", mode: "fast" });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen.at(-1).state, { question: "두 번째 가상 질문", mode: "fast" });
});

test("모르는 탭으로 navigate하면 예외", () => {
  const { router } = start("#/home");
  assert.throws(() => router.navigate("settings"), RangeError);
});

test("stop 뒤에는 해시 변화를 듣지 않는다", () => {
  const { win, seen, router } = start("#/home");
  router.stop();
  win.location.hash = "#/more";
  assert.equal(seen.length, 1);
});

test("필수 인자가 없으면 예외", () => {
  assert.throws(() => createRouter({}), TypeError);
  assert.throws(() => createRouter({ win: fakeWindow() }), TypeError);
});
