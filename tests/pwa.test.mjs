import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
// 아이콘은 저장소에 없고 생성기가 만든다. 작업 폴더를 더럽히지 않게 임시 폴더에 만들어 확인한다.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeIcons } from "../tools/make-icons.mjs";
const iconFiles = makeIcons(mkdtempSync(join(tmpdir(), "aio-icons-")));

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url));
const files = ["./", "index.html", "manifest.webmanifest", "assets/app.css", "assets/app.js",
  "assets/home.mjs", "assets/router.mjs", "assets/config.mjs", "assets/api.mjs",
  "assets/icons/icon-192.png", "assets/icons/icon-512.png"];

function worker(scope = "https://example.invalid/app/") {
  const events = {};
  const calls = { opened: [], deleted: [], added: [], fetched: [], claimed: 0 };
  const cache = { addAll: async (urls) => calls.added.push(...urls), match: async () => "cached" };
  vm.runInNewContext(read("web/sw.js").toString(), {
    URL,
    self: { registration: { scope }, addEventListener: (name, handler) => { events[name] = handler; },
      clients: { claim: async () => { calls.claimed += 1; } } },
    caches: { open: async (name) => { calls.opened.push(name); return cache; },
      keys: async () => ["aio-shell-v0", "aio-shell-v1", "unrelated"],
      delete: async (name) => calls.deleted.push(name) },
    fetch: async (request) => { calls.fetched.push(request); return "network"; },
  });
  return { events, calls, cache };
}

test("manifest and real PNG icon dimensions match", () => {
  const manifest = JSON.parse(read("web/manifest.webmanifest"));
  assert.equal(manifest.name, "아이오 · 금오공대 학사 행정");
  assert.equal(manifest.short_name, "아이오");
  assert.equal(manifest.start_url, "./#/home");
  assert.equal(manifest.theme_color, "#0A2540");
  assert.equal(manifest.background_color, "#F5F9FC");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  for (const icon of manifest.icons) {
    const size0 = Number(icon.sizes.split("x")[0]);
    assert.equal(icon.src, `assets/icons/icon-${size0}.png`);
    const png = readFileSync(iconFiles[size0]);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.toString("ascii", 12, 16), "IHDR");
    const size = Number(icon.sizes.split("x")[0]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
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

test("activate removes only older app caches", async () => {
  const { events, calls } = worker();
  let pending;
  events.activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual(calls.deleted, ["aio-shell-v0"]);
  assert.equal(calls.claimed, 1);
});

test("API, foreign origin, POST and unlisted URLs never touch caches or respondWith", () => {
  const { events, calls } = worker();
  for (const [url, method] of [
    ["https://example.invalid/api/v1/health", "GET"],
    ["https://example.invalid/app/api/v1/health", "GET"],
    ["https://kumoh-campus.onrender.com/api/v1/health", "GET"],
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
