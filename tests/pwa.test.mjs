import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import vm from "node:vm";
import { inflateSync } from "node:zlib";
import { ICON_SIZES, iconPng } from "../tools/make-icons.mjs";
const webRoot = new URL("../web/", import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const generatedIcons = new Map([
  ["assets/icons/icon-192.png", 192], ["assets/icons/icon-512.png", 512],
]);
const files = ["./", "index.html", "manifest.webmanifest", "assets/app.css", "assets/app.js",
  "assets/home.mjs", "assets/router.mjs", "assets/config.mjs", "assets/api.mjs",
  "assets/chat-view.mjs", "assets/chat-client.mjs", "assets/chat-history.mjs",
  "assets/demo-login.mjs", "assets/graduation-view.mjs", "assets/calendar-view.mjs",
  "assets/appearance.mjs",
  "assets/handwriting-pad.mjs", "assets/handwriting-geometry.mjs",
  ...generatedIcons.keys()];
const requireFullShell = process.env.AIO_REQUIRE_FULL_SHELL === "1";
const screenFiles = ["index.html", "assets/app.css", "assets/app.js", "assets/home.mjs", "assets/router.mjs",
  "assets/chat-view.mjs"];
const requireScreen = requireFullShell || screenFiles.some((file) => existsSync(new URL(file, webRoot)));
// 작업 A(다른 브랜치)가 만드는 모듈. 이 체크아웃에 없을 때만 건너뛴다(AIO_REQUIRE_FULL_SHELL=1이면 필수).
const taskAFiles = ["assets/chat-client.mjs", "assets/chat-history.mjs"];
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

function worker(scope = "https://example.invalid/app/") {
  const events = {};
  const calls = { opened: [], deleted: [], added: [], fetched: [], claimed: 0 };
  const cache = { addAll: async (urls) => calls.added.push(...urls), match: async () => "cached" };
  vm.runInNewContext(read("web/sw.js").toString(), {
    URL,
    self: { registration: { scope }, addEventListener: (name, handler) => { events[name] = handler; },
      clients: { claim: async () => { calls.claimed += 1; } } },
    caches: { open: async (name) => { calls.opened.push(name); return cache; },
      keys: async () => ["aio-shell-v0", "aio-shell-v1", "aio-shell-v2", "aio-shell-v3", "aio-shell-v4",
        "aio-shell-v5", "aio-shell-v6", "aio-shell-v7", "unrelated"],
      delete: async (name) => calls.deleted.push(name) },
    fetch: async (request) => { calls.fetched.push(request); return "network"; },
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

test("activate removes v7 and older app caches and keeps CACHE_NAME v8", async () => {
  const { events, calls } = worker();
  let pending;
  events.install({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual(calls.opened, ["aio-shell-v8"]);
  events.activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual(calls.deleted,
    ["aio-shell-v0", "aio-shell-v1", "aio-shell-v2", "aio-shell-v3", "aio-shell-v4", "aio-shell-v5",
      "aio-shell-v6", "aio-shell-v7"]);
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

test("listed GET uses shell cache and falls back to network on miss", async () => {
  const { events, calls, cache } = worker();
  const request = { url: "https://example.invalid/app/index.html", method: "GET" };
  let pending;
  const event = { request, respondWith: (promise) => { pending = promise; } };
  events.fetch(event);
  assert.equal(await pending, "cached");
  cache.match = async () => undefined;
  events.fetch(event);
  assert.equal(await pending, "network");
  assert.equal(calls.fetched.length, 1);
});

// app.js의 import 줄을 걷어 내고 모듈 함수를 스텁으로 넣어 부팅한다. 네트워크와 저장소는 쓰지 않는다.
function bootApp(startRoute, storage = null) {
  const calls = { refresh: 0, calendarRefresh: 0, moves: [], students: 0, login: [], diagnosis: [], handwritingClose: 0 };
  const roots = new Map();
  const doc = {
    getElementById(id) {
      if (!roots.has(id)) roots.set(id, { id, focus() {} });
      return roots.get(id);
    },
    querySelectorAll: () => [],
  };
  const options = {};
  const diagnosis = { show() {}, clear() {} };
  const fetchStub = async () => assert.fail("unexpected network request");
  vm.runInNewContext(read("web/assets/app.js").toString().replace(/^import .*;\r?\n/gm, ""), {
    API_BASE: "https://example.invalid",
    fetch: fetchStub,
    document: doc,
    window: {},
    navigator: {},
    createApi: () => ({
      demoStudents: async () => { calls.students += 1; return { students: [] }; },
      demoLogin: async (id) => { calls.login.push(id); },
      graduationDemo: async (id) => { calls.diagnosis.push(id); },
    }),
    createChatClient: () => ({}),
    createChatHistory: () => ({}),
    createPrefStorage: () => ({}),
    createHandwritingPad(opts) {
      options.handwriting = opts;
      return { open() {}, close() { calls.handwritingClose += 1; } };
    },
    mountChat: () => ({ refresh() {} }),
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
