import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import vm from "node:vm";
import { inflateSync } from "node:zlib";
import { ICON_SIZES, iconPng } from "../tools/make-icons.mjs";
import { createSelectionIndicator } from "../web/assets/selection-indicator.mjs";
const webRoot = new URL("../web/", import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const generatedIcons = new Map([
  ["assets/icons/icon-192.png", 192], ["assets/icons/icon-512.png", 512],
]);
const files = ["./", "index.html", "manifest.webmanifest", "assets/app.css", "assets/app.js",
  "assets/home.mjs", "assets/router.mjs", "assets/config.mjs", "assets/api.mjs",
  "assets/chat-view.mjs", "assets/chat-client.mjs", "assets/chat-history.mjs",
  "assets/demo-login.mjs", "assets/graduation-view.mjs", "assets/calendar-view.mjs",
  "assets/calendar-grid.mjs", "assets/appearance.mjs",
  "assets/handwriting-pad.mjs", "assets/handwriting-geometry.mjs",
  "assets/quick-actions.mjs", "assets/selection-indicator.mjs", "assets/send-icon.mjs",
  ...generatedIcons.keys()];
const requireFullShell = process.env.AIO_REQUIRE_FULL_SHELL === "1";
const screenFiles = ["index.html", "assets/app.css", "assets/app.js", "assets/home.mjs", "assets/router.mjs",
  "assets/chat-view.mjs"];
const requireScreen = requireFullShell || screenFiles.some((file) => existsSync(new URL(file, webRoot)));
// 작업 A(다른 브랜치)가 만드는 모듈. 이 체크아웃에 없을 때만 건너뛴다(AIO_REQUIRE_FULL_SHELL=1이면 필수).
const taskAFiles = ["assets/chat-client.mjs", "assets/chat-history.mjs", "assets/calendar-grid.mjs"];
// 작업 B의 진단 화면과 일정 모듈은 통합 브랜치에서 함께 검사한다.
const taskBFiles = ["assets/graduation-view.mjs", "assets/calendar-view.mjs"];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunks(png) {
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    const crc = png.readUInt32BE(offset + 8 + length);
    assert.equal(crc, crc32(png.subarray(offset + 4, offset + 8 + length)), `${type} CRC mismatch`);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

function assertFile(file) {
  assert.ok(statSync(file, { throwIfNoEntry: false })?.isFile(), `Missing cache file: ${file.pathname}`);
}

function worker(scope = "https://example.invalid/app/", fetchResponse = () => "network") {
  const events = {};
  const calls = { opened: [], deleted: [], added: [], fetched: [], claimed: 0 };
  const cache = { addAll: async (urls) => calls.added.push(...urls), match: async () => "cached" };
  vm.runInNewContext(read("web/sw.js").toString(), {
    URL,
    self: { registration: { scope }, addEventListener: (name, handler) => { events[name] = handler; },
      clients: { claim: async () => { calls.claimed += 1; } } },
    caches: { open: async (name) => { calls.opened.push(name); return cache; },
      keys: async () => ["aio-shell-v0", "aio-shell-v1", "aio-shell-v2", "aio-shell-v3", "aio-shell-v4",
        "aio-shell-v5", "aio-shell-v6", "aio-shell-v7", "aio-shell-v8", "aio-shell-v9", "aio-shell-v10",
        "aio-shell-v11", "aio-shell-v12", "unrelated"],
      delete: async (name) => calls.deleted.push(name) },
    fetch: async (request, options) => {
      calls.fetched.push({ request, cache: options?.cache });
      return fetchResponse(request);
    },
  });
  return { events, calls, cache };
}

test("manifest and real PNG icon dimensions match", () => {
  assert.deepEqual(ICON_SIZES, [192, 512]);
  const manifest = JSON.parse(read("web/manifest.webmanifest"));
  assert.equal(manifest.name, "아이오 · 금오공대 학사 행정");
  assert.equal(manifest.short_name, "아이오");
  assert.equal(manifest.start_url, "./#/home");
  assert.equal(manifest.theme_color, "#0A2540");
  assert.equal(manifest.background_color, "#F5F9FC");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  for (const icon of manifest.icons) {
    const size = Number(icon.sizes.split("x")[0]);
    assert.equal(generatedIcons.get(icon.src), size);
    const png = iconPng(size);
    assert.ok(Buffer.isBuffer(png));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    const chunks = pngChunks(png); // Verifies every chunk CRC.
    assert.equal(chunks[0].type, "IHDR");
    assert.equal(chunks.at(-1).type, "IEND");
    const idat = Buffer.concat(chunks.filter((entry) => entry.type === "IDAT").map((entry) => entry.data));
    assert.equal(inflateSync(idat).length, size * (size * 3 + 1));
  }
});

for (const scope of ["https://example.invalid/app/", "https://localhost/"]) {
  test(`install caches only fixed scope-relative shell at ${scope}`, async () => {
    const { events, calls } = worker(scope);
    let pending;
    events.install({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    assert.deepEqual(calls.added, files.map((file) => new URL(file, scope).href));
  });
}

test("precache files exist or are generated icons", async () => {
  const scope = "https://example.invalid/";
  const { events, calls } = worker(scope);
  let pending;
  events.install({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  for (const url of calls.added) {
    const file = url.slice(scope.length);
    if (generatedIcons.has(file)) continue; // PNG dimensions are checked in the generator test.
    const path = file || "index.html"; // The scope root is served by index.html.
    if (!requireScreen && screenFiles.includes(path)) continue;
    const target = new URL(path, webRoot);
    if (!requireFullShell && taskAFiles.includes(path) && !existsSync(target)) continue;
    if (!requireFullShell && taskBFiles.includes(path) && !existsSync(target)) continue;
    assertFile(target);
  }
});

test("activate removes v0 through v11 app caches and preserves v12 and unrelated caches", async () => {
  const { events, calls } = worker();
  let pending;
  events.install({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual(calls.opened, ["aio-shell-v12"]);
  assert.ok(calls.added.includes("https://example.invalid/app/assets/send-icon.mjs"), "send icon module is cached");
  events.activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual(calls.deleted,
    ["aio-shell-v0", "aio-shell-v1", "aio-shell-v2", "aio-shell-v3", "aio-shell-v4", "aio-shell-v5",
      "aio-shell-v6", "aio-shell-v7", "aio-shell-v8", "aio-shell-v9", "aio-shell-v10", "aio-shell-v11"]);
  assert.equal(calls.claimed, 1);
});

test("more view replaces the empty card with static Android Chrome and iOS Safari install guides", () => {
  const html = read("web/index.html").toString();
  const view = html.match(/<section[^>]*data-view="more"[\s\S]*?<\/main>/)?.[0] ?? "";
  assert.ok(view, "more view exists");
  assert.doesNotMatch(view, /empty-state|들어갈 예정/);
  assert.match(view, /홈 화면에 아이오 설치하기/);
  for (const [platform, heading] of [["android", "Android · Chrome"], ["ios", "iPhone · Safari"]]) {
    const card = view.match(new RegExp(`<section[^>]*data-install="${platform}"[\\s\\S]*?</section>`))?.[0] ?? "";
    assert.match(card, /class="card install-card"/, `${platform} card uses the shared card style`);
    assert.ok(card.includes(heading), `${platform} heading`);
    assert.match(card, /<ol class="install-steps">/);
    assert.match(card, /홈 화면에 추가/);
  }
  // 정적 안내만 둔다. APK 내려받기, 설치 이벤트 버튼, 외부 링크를 넣지 않는다.
  assert.doesNotMatch(view, /\.apk|APK|<a\s|<button|<script|href=/i);
});

test("install guide styles reuse theme variables without new colors", () => {
  const css = read("web/assets/app.css").toString();
  const block = css.match(/\.more \{[\s\S]*?(?=@media \(max-width: 380px\))/)?.[0] ?? "";
  assert.match(block, /\.install-card \{[^}]*border-left: 4px solid var\(--color-sky\)/);
  assert.match(block, /\.install-lead,\s*\.install-note \{[^}]*color: var\(--color-text-muted\)/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,6}\b/i, "colors come from :root variables");
});

test("API, foreign origin, POST and unlisted URLs never touch caches or respondWith", () => {
  const { events, calls } = worker();
  for (const [url, method] of [
    ["https://example.invalid/api/v1/health", "GET"],
    ["https://example.invalid/app/api/v1/health", "GET"],
    ["https://kumoh-campus.onrender.com/api/v1/health", "GET"],
    ["https://example.invalid/app/api/v1/demo-students", "GET"],
    ["https://example.invalid/app/api/v1/demo-login", "POST"],
    ["https://example.invalid/app/api/v1/handwriting", "POST"],
    ["https://kumoh-campus.onrender.com/api/v1/handwriting", "POST"],
    ["https://example.invalid/app/api/v1/graduation-demo?student_id=demo-d02", "GET"],
    ["https://kumoh-campus.onrender.com/api/v1/demo-students", "GET"],
    ["https://kumoh-campus.onrender.com/api/v1/demo-login", "POST"],
    ["https://kumoh-campus.onrender.com/api/v1/graduation-demo?student_id=demo-d02", "GET"],
    ["https://example.invalid/app/api/v1/academic-calendar/2027/1", "GET"],
    ["https://kumoh-campus.onrender.com/api/v1/academic-calendar/2027/1", "GET"],
    ["https://elsewhere.invalid/app/index.html", "GET"],
    ["https://example.invalid/app/index.html", "POST"],
    ["https://example.invalid/app/unknown.html", "GET"],
    ["https://example.invalid/app/index.html?query=1", "GET"],
  ]) {
    events.fetch({ request: { url, method }, respondWith: () => assert.fail("intercepted") });
  }
  assert.deepEqual(calls.opened, []);
  assert.deepEqual(calls.fetched, []);
});

test("Android packages the pinned App plugin with its license and preserves default back handling", () => {
  const packages = JSON.parse(read("package.json"));
  const config = JSON.parse(read("capacitor.config.json"));
  const workflow = read(".github/workflows/android.yml").toString();
  assert.equal(packages.dependencies["@capacitor/app"], "8.1.2");
  assert.equal(config.plugins.App.disableBackButtonHandler, true);
  assert.match(workflow, /cp node_modules\/@capacitor\/app\/LICENSE android\/app\/src\/main\/assets\/licenses\/Capacitor-App-MIT\.txt/);
});

function fetchShell(events, request) {
  let pending;
  events.fetch({ request, respondWith: (promise) => { pending = promise; } });
  return pending;
}

test("listed CSS GET refreshes the old shell entry for the next offline load", async () => {
  const freshCss = new Response(".tab-bar::before { content: ''; }");
  const staleCss = new Response(".tab-bar { display: grid; }");
  const request = { url: "https://example.invalid/app/assets/app.css", method: "GET" };
  const entries = new Map([[request.url, staleCss]]);
  let online = true;
  const { events, calls, cache } = worker(undefined, () => {
    if (!online) throw new TypeError("offline");
    return freshCss;
  });
  cache.match = async (key) => entries.get(key.url);
  cache.put = async (key, response) => {
    assert.notEqual(response, freshCss);
    entries.set(key.url, response);
  };

  assert.equal(await fetchShell(events, request), freshCss);
  assert.equal(await freshCss.text(), ".tab-bar::before { content: ''; }");
  assert.deepEqual(calls.fetched, [{ request, cache: "no-cache" }]);

  online = false;
  const offlineCss = await fetchShell(events, request);
  assert.equal(await offlineCss.text(), ".tab-bar::before { content: ''; }");
  assert.deepEqual(calls.opened, ["aio-shell-v12", "aio-shell-v12"]);
});

test("a shell cache write failure still returns the online response", async () => {
  const fresh = new Response("updated");
  const { events, calls, cache } = worker(undefined, () => fresh);
  cache.put = async () => { throw new Error("cache quota exceeded"); };
  cache.match = async () => assert.fail("a successful fetch needs no fallback");
  const request = { url: "https://example.invalid/app/index.html", method: "GET" };
  assert.equal(await fetchShell(events, request), fresh);
  assert.deepEqual(calls.opened, ["aio-shell-v12"]);
});

test("listed GET falls back to the shell cache only when fetch rejects", async () => {
  const offline = new TypeError("offline");
  const { events, calls, cache } = worker(undefined, () => { throw offline; });
  const request = { url: "https://example.invalid/app/index.html", method: "GET" };
  cache.match = async (key) => {
    assert.equal(key, request);
    assert.equal(calls.fetched.length, 1);
    return "cached";
  };
  assert.equal(await fetchShell(events, request), "cached");
  assert.deepEqual(calls.opened, ["aio-shell-v12"]);

  cache.match = async () => undefined;
  await assert.rejects(fetchShell(events, request), (error) => error === offline);
  assert.equal(calls.fetched.length, 2);
});

test("online HTTP errors do not fall back to a stale shell file", async () => {
  const unavailable = new Response(null, { status: 503 });
  const { events, calls } = worker(undefined, () => unavailable);
  const request = { url: "https://example.invalid/app/index.html", method: "GET" };
  assert.equal(await fetchShell(events, request), unavailable);
  assert.deepEqual(calls.opened, []);
});

// app.js의 import 줄을 걷어 내고 모듈 함수를 스텁으로 넣어 부팅한다. 네트워크와 저장소는 쓰지 않는다.
// 전송 아이콘 모듈은 부팅을 막지 않는 동적 import다. 가짜 로더(Promise)로 바꿔 끼워 대기·성공·실패를 정한다.
const SEND_ICON_IMPORT = 'import("./send-icon.mjs")';
function bootApp(startRoute, storage = null, { tabBar = null, tabs = [], loadSendIcon = null } = {}) {
  const calls = { refresh: 0, calendarRefresh: 0, moves: [], students: 0, login: [], diagnosis: [], handwritingClose: 0, quickActionsClose: 0 };
  const roots = new Map();
  const doc = {
    getElementById(id) {
      if (!roots.has(id)) roots.set(id, {
        id, attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        focus() { calls.focused = this; },
      });
      return roots.get(id);
    },
    querySelectorAll: (selector) => selector === "[data-tab]" ? tabs : [],
    querySelector: (selector) => selector === ".tab-bar" ? tabBar : null,
  };
  const options = {};
  const diagnosis = { show() {}, clear() {} };
  const fetchStub = async () => assert.fail("unexpected network request");
  const source = read("web/assets/app.js").toString();
  assert.equal(source.split(SEND_ICON_IMPORT).length, 2, "send-icon.mjs dynamic import appears once");
  vm.runInNewContext(source.replace(/^import .*;\r?\n/gm, "").replace(SEND_ICON_IMPORT, "loadSendIconModule()"), {
    loadSendIconModule: loadSendIcon ?? (async () => ({
      mountSendIcon(button, opts) {
        calls.sendIcon = { button, opts };
        return { setStopping() {} };
      },
    })),
    API_BASE: "https://example.invalid",
    fetch: fetchStub,
    document: doc,
    window: tabBar?.ownerDocument.defaultView ?? {},
    navigator: {},
    createApi: () => ({
      demoStudents: async () => { calls.students += 1; return { students: [] }; },
      demoLogin: async (id) => { calls.login.push(id); },
      graduationDemo: async (id) => { calls.diagnosis.push(id); },
    }),
    createChatClient: () => ({}),
    createChatHistory: () => ({}),
    createPrefStorage: () => ({}),
    createSelectionIndicator: tabBar ? createSelectionIndicator : () => () => {},
    createHandwritingPad(opts) {
      options.handwriting = opts;
      return { open() {}, close() { calls.handwritingClose += 1; } };
    },
    mountChat(opts) {
      options.chat = opts;
      return { refresh() {}, closeQuickActions() { calls.quickActionsClose += 1; } };
    },
    mountHome: () => ({}),
    mountAppearance(opts) {
      assert.equal(options.appearance, undefined, "mountAppearance runs only at boot");
      options.appearance = opts;
    },
    syncHomeMode() {},
    mountGraduationDiagnosis(opts) { options.diagnosis = opts; return diagnosis; },
    mountDemoLogin(opts) {
      options.login = opts;
      return { refresh() { calls.refresh += 1; } };
    },
    mountCalendar(opts) {
      options.calendar = opts;
      return { refresh: async () => { calls.calendarRefresh += 1; } };
    },
    createRouter: ({ onRoute }) => {
      options.onRoute = onRoute;
      return {
        start() {
          assert.ok(options.appearance, "appearance is ready before the initial route");
          onRoute({ route: startRoute });
        },
        navigate: (route, state) => calls.moves.push({ route, state }),
      };
    },
    get localStorage() {
      if (storage === null) throw new Error("가상 저장소 접근 오류");
      return storage;
    },
  });
  return { calls, roots, options, diagnosis, doc };
}

test("rapid tab selections update the indicator and aria-current to the final tab", () => {
  const ownerDocument = { defaultView: {
    getComputedStyle: () => ({ borderLeftWidth: "0px", borderRightWidth: "0px" }),
    addEventListener() {},
  } };
  const attributes = new Map();
  const style = new Map();
  const transitions = [];
  const tabBar = {
    ownerDocument,
    getBoundingClientRect: () => ({ left: 12, right: 267, width: 255 }),
    setAttribute(name, value) {
      attributes.set(name, value);
      if (name === "data-indicator") transitions.push(value);
    },
    style: { setProperty: (name, value) => style.set(name, value) },
  };
  const routes = ["home", "aio", "graduation", "calendar", "more"];
  const tabs = routes.map((route, index) => {
    const attributes = new Map([["data-tab", route]]);
    const listeners = new Map();
    return {
      getBoundingClientRect: () => ({ left: 12 + index * 51, right: 63 + index * 51, width: 51 }),
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
      getAttribute: (name) => attributes.get(name) ?? null,
      addEventListener: (name, listener) => listeners.set(name, listener),
      click: () => listeners.get("click")({ button: 0 }),
    };
  });
  const { calls, options, roots } = bootApp("home", null, { tabBar, tabs });
  assert.deepEqual([...style], [["--indicator-left", "0px"], ["--indicator-right", "204px"]]);
  assert.deepEqual(transitions, ["instant", "ready"]);
  for (const index of [3, 0, 4, 1]) {
    tabs[index].click();
    options.onRoute({ route: routes[index] });
  }
  assert.deepEqual([...style], [["--indicator-left", "51px"], ["--indicator-right", "153px"]]);
  assert.equal(attributes.get("data-indicator-dir"), "back");
  assert.equal(attributes.get("data-indicator"), "ready");
  assert.deepEqual(transitions, ["instant", "ready"]);
  assert.deepEqual(tabs.map((tab) => tab.getAttribute("aria-current")), [null, "page", null, null, null]);
  assert.equal(calls.focused, roots.get("title-aio"));

  tabs[1].click();
  options.onRoute({ route: "aio" });
  assert.deepEqual([...style], [["--indicator-left", "51px"], ["--indicator-right", "153px"]]);
  assert.equal(attributes.get("data-indicator-dir"), "back");

  transitions.length = 0;
  options.onRoute({ route: "home" });
  assert.deepEqual(transitions, ["instant", "ready"]);
  assert.deepEqual(tabs.map((tab) => tab.getAttribute("aria-current")), ["page", null, null, null, null]);
});

test("quick actions navigate existing tabs and focus BISKIT after the route becomes visible", () => {
  const { calls, options, doc } = bootApp("aio");
  const actions = options.chat.quickActions;
  actions.find((action) => action.id === "calendar").run();
  actions.find((action) => action.id === "graduation").run();
  actions.find((action) => action.id === "biskit").run();
  assert.deepEqual(calls.moves.map((move) => move.route), ["calendar", "graduation", "graduation"]);
  assert.equal(calls.moves[2].state.section, "recommendations");
  options.onRoute(calls.moves[2]);
  assert.equal(calls.focused.id, "title-graduation");
  assert.equal(calls.focused.attributes.get("tabindex"), "-1");
  const recommendation = { focus() { calls.focused = this; }, setAttribute(name, value) { this[name] = value; } };
  doc.querySelector = (selector) => {
    assert.equal(selector, '[data-grad-section="recommendations"] h2');
    return recommendation;
  };
  options.onRoute(calls.moves[2]);
  assert.equal(calls.focused, recommendation);
  assert.equal(recommendation.tabindex, "-1");
});

test("app restores appearance before the initial route even when storage access throws", () => {
  const storage = {};
  const available = bootApp("home", storage);
  assert.equal(available.options.appearance.doc, available.doc);
  assert.equal(available.options.appearance.storage, storage);
  available.options.onRoute({ route: "more" });

  const unavailable = bootApp("more");
  assert.equal(unavailable.options.appearance.storage, null);
});

test("leaving the AIO tab closes the handwriting pad", () => {
  const { calls, options, doc } = bootApp("aio");
  assert.equal(options.handwriting.doc, doc);
  assert.equal(typeof options.handwriting.recognize, "function");
  assert.equal(calls.handwritingClose, 0);
  options.onRoute({ route: "home" });
  assert.equal(calls.handwritingClose, 1);
});

const settle = () => new Promise((resolve) => setImmediate(resolve));

// chat-view가 만드는 전송 버튼을 흉내 낸다. 글자 span 하나만 찾을 수 있다.
function fakeSendButton() {
  const label = { textContent: "보내기" };
  return {
    label,
    querySelector: (selector) => (selector === ".chat-send-label" ? label : null),
  };
}

test("a pending send icon request never blocks boot and the factory keeps the text label in sync", () => {
  // 셸은 응답하고 send-icon.mjs 요청만 끝나지 않는 상황
  const { calls, options } = bootApp("calendar", null, { loadSendIcon: () => new Promise(() => {}) });
  assert.equal(calls.calendarRefresh, 1, "the router started and showed the first route");
  assert.equal(typeof options.chat.sendIcon, "function");
  assert.equal(typeof options.calendar, "object");
  const button = fakeSendButton();
  const icon = options.chat.sendIcon(button);
  icon.setStopping(true);
  assert.equal(button.label.textContent, "중단");
  icon.setStopping(false);
  assert.equal(button.label.textContent, "보내기");
  const source = read("web/assets/app.js").toString();
  assert.doesNotMatch(source, /^import[^;]*["']\.\/send-icon\.mjs["']/m, "no static import of a module the old worker cannot serve");
  assert.doesNotMatch(source, /\bawait\b/, "boot awaits nothing");
});

test("a late send icon module mounts on the same button in the current stop shape", async () => {
  let release;
  const mounted = [];
  const states = [];
  const { options, doc } = bootApp("aio", null, { loadSendIcon: () => new Promise((resolve) => { release = resolve; }) });
  const button = fakeSendButton();
  const icon = options.chat.sendIcon(button);
  icon.setStopping(true); // 응답이 아이콘보다 먼저 시작됐다
  release({
    mountSendIcon(target, opts) {
      mounted.push({ target, opts });
      return { setStopping: (on) => states.push(on) };
    },
  });
  await settle();
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].target, button);
  assert.equal(mounted[0].opts.doc, doc);
  assert.equal(typeof mounted[0].opts.win, "object");
  // 붙이는 순간의 상태로 그린다. 붙인 뒤 setStopping(true)를 부르면 화살표에서 정지로 모핑해 보인다.
  assert.equal(mounted[0].opts.stopping, true, "mounts directly in the stop shape");
  assert.deepEqual(states, [], "no morph from the arrow right after mounting");
  icon.setStopping(false);
  assert.deepEqual(states, [false]);
  assert.equal(button.label.textContent, "보내기", "the hidden label still follows the state");
});

test("a failed send icon module under the previous worker leaves a working text button", async () => {
  // v11 워커는 새 app.js를 저장하지만 send-icon.mjs는 모른다. 오프라인에서 그 import가 실패해도
  // chat-view는 sendIcon을 받았으므로 글자를 바꾸지 않는다. 팩터리가 "보내기"↔"중단"을 맡는다.
  for (const outcome of [() => Promise.reject(new TypeError("offline: send-icon.mjs not cached")),
    async () => ({}), async () => ({ mountSendIcon() { throw new Error("가상 마운트 오류"); } })]) {
    const { options, calls } = bootApp("aio", null, { loadSendIcon: outcome });
    const button = fakeSendButton();
    const icon = options.chat.sendIcon(button);
    await settle();
    icon.setStopping(true);
    assert.equal(button.label.textContent, "중단");
    icon.setStopping(false);
    assert.equal(button.label.textContent, "보내기");
    assert.equal(calls.sendIcon, undefined);
  }
});

test("leaving the AIO tab closes quick actions", () => {
  const { calls, options } = bootApp("aio");
  assert.equal(calls.quickActionsClose, 0);
  options.onRoute({ route: "calendar" });
  assert.equal(calls.quickActionsClose, 1);
});

test("calendar tab mounts the calendar module once and refreshes on each entry", () => {
  const { calls, roots, options, doc } = bootApp("home");
  const mounted = options.calendar;
  assert.equal(mounted.root, roots.get("calendar-root"));
  assert.equal(mounted.doc, doc);
  assert.equal(typeof mounted.fetchImpl, "function");
  assert.equal(mounted.base, "https://example.invalid");
  assert.equal(mounted.initialYear, 2027);
  assert.equal(mounted.initialTerm, 1);
  assert.equal(calls.calendarRefresh, 0, "home start must not fetch the calendar");
  options.onRoute({ route: "calendar" });
  assert.equal(calls.calendarRefresh, 1);
  options.onRoute({ route: "graduation" });
  assert.equal(calls.calendarRefresh, 1);
  assert.equal(options.calendar, mounted, "mountCalendar runs only at boot");
});

test("index.html leaves only the calendar root in the calendar view", () => {
  const html = read("web/index.html").toString();
  const view = html.match(/<section[^>]*data-view="calendar"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.match(view, /<div id="calendar-root"><\/div>/);
  assert.doesNotMatch(view, /준비하고 있어요/);
});

test("graduation tab connects demo login and diagnosis with a general chat question", async () => {
  const { calls, roots, options, diagnosis } = bootApp("graduation");
  const { diagnosis: diagnosisOptions, login: loginOptions } = options;
  assert.equal(loginOptions.root, roots.get("graduation-login-root"));
  assert.equal(diagnosisOptions.root, roots.get("graduation-root"));
  assert.equal(loginOptions.diagnosis, diagnosis);
  assert.equal(calls.refresh, 1);
  await loginOptions.loadStudents();
  await loginOptions.login("demo-d03");
  await diagnosisOptions.loadDiagnosis("demo-d03");
  assert.equal(calls.students, 1);
  assert.deepEqual(calls.login, ["demo-d03"]);
  assert.deepEqual(calls.diagnosis, ["demo-d03"]);
  diagnosisOptions.onAsk({ studentId: "demo-d03", question: "가상 계정 정보" });
  assert.equal(calls.moves[0].route, "aio");
  assert.equal(calls.moves[0].state.question, "졸업 요건과 확인 방법을 알려 주세요.");
  assert.deepEqual(Object.keys(calls.moves[0].state), ["question"]);
});
