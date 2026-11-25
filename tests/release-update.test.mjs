import assert from "node:assert/strict";
import test from "node:test";
import {
  compareVersions, initReleaseUpdate, parseRelease, RELEASE_URL, SKIPPED_VERSION_KEY,
} from "../web/assets/release-update.mjs";

const releaseEndpoint = "https://api.github.com/repos/kumoh-aio/aio-app/releases/latest";
const downloadUrl = (version) => `https://github.com/kumoh-aio/aio-app/releases/download/v${version}/aio-release.apk`;
const release = (version = "1.2.0") => ({
  tag_name: `v${version}`,
  assets: [
    { name: "SHA256SUMS" },
    { name: "aio-release.apk", browser_download_url: downloadUrl(version) },
  ],
});
const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });

class Element {
  constructor(document, tagName) {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.open = false;
  }

  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...children) { this.children.push(...children); }
  remove() {
    const body = this.ownerDocument.body;
    body.children = body.children.filter((child) => child !== this);
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, props = {}) {
    const event = {
      ...props,
      target: this,
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; this.focus(); }
  close() { this.open = false; this.dispatch("close"); }
  *walk() {
    yield this;
    for (const child of this.children) yield* child.walk();
  }
}

function fixture({
  native = true, platform = "android", installed = "1.1.0", version = "1.2.0",
  entries = new Map(), storage, request = async () => ok(release(version)),
  getInfo = async () => ({ version: installed }), timers = {},
} = {}) {
  const document = { createElement: (tagName) => new Element(document, tagName) };
  document.body = document.createElement("body");
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const calls = [];
  const downloads = [];
  let appReads = 0;
  const start = () => initReleaseUpdate({
    capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => platform,
      Plugins: { App: { getInfo: () => { appReads++; return getInfo(); } } },
    },
    document,
    storage: storage ?? {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    },
    fetch: (...args) => { calls.push(args); return request(...args); },
    openDownload: (url) => downloads.push(url),
    ...timers,
  });
  return {
    start, document, trigger, calls, entries, downloads,
    get appReads() { return appReads; },
    get dialog() { return document.body.children.find((node) => node.tagName === "DIALOG"); },
  };
}

test("compares the three numeric components and ignores an installed -debug suffix", () => {
  assert.equal(compareVersions("2.0.0", "1.99.99-debug"), 1);
  assert.equal(compareVersions("1.2.99", "1.10.0-debug"), -1);
  assert.equal(compareVersions("1.2.10", "1.2.9-debug"), 1);
  assert.equal(compareVersions("0.0.7", "0.0.7-debug"), 0);
  assert.equal(compareVersions("9007199254740993.0.0", "9007199254740992.0.0"), 1);
  for (const invalid of [null, "", "v1.2.3", "1.2", "01.2.3", "1.02.3", "1.2.03", "1.2.3-rc.1", "1.2.3-debug-debug", "1.2.3\n"]) {
    assert.equal(compareVersions("1.2.3", invalid), null, JSON.stringify(invalid));
  }
});

test("accepts only the exact release tag and APK asset URL", () => {
  assert.deepEqual(parseRelease(release()), { version: "1.2.0", url: downloadUrl("1.2.0") });
  assert.deepEqual(parseRelease(release("0.0.0")), { version: "0.0.0", url: downloadUrl("0.0.0") });
  for (const tag_name of [1, "", "1.2.0", "v1.2", "v01.2.0", "v1.02.0", "v1.2.00", "v1.2.0-rc.1", "v1.2.0\n"]) {
    assert.equal(parseRelease({ ...release(), tag_name }), null, JSON.stringify(tag_name));
  }
  for (const payload of [null, [], {}, { ...release(), assets: {} }, { ...release(), assets: release().assets.slice(0, 1) }]) {
    assert.equal(parseRelease(payload), null, JSON.stringify(payload));
  }
  const url = downloadUrl("1.2.0");
  for (const badUrl of [undefined, url.replace("https:", "http:"), url.replace("github.com", "example.invalid"), url.replace("aio-app", "other-repo"), downloadUrl("1.2.1"), `${url}?preview=1`]) {
    assert.equal(parseRelease({ ...release(), assets: [{ name: "aio-release.apk", browser_download_url: badUrl }] }), null);
  }
  assert.equal(parseRelease({ ...release(), assets: [{ name: "AIO-RELEASE.APK", browser_download_url: url }] }), null);
});

test("sends one anonymous GET at startup on native Android only", async () => {
  assert.equal(RELEASE_URL, releaseEndpoint);
  const android = fixture();
  await android.start();
  assert.equal(android.appReads, 1);
  assert.equal(android.calls.length, 1);
  const [[url, options]] = android.calls;
  assert.equal(url, releaseEndpoint);
  assert.ok(options.signal instanceof AbortSignal);
  assert.deepEqual({ ...options, signal: undefined }, {
    method: "GET", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: undefined,
  });
  for (const platform of [{ native: false, platform: "web" }, { native: false }, { platform: "ios" }]) {
    const environment = fixture(platform);
    await environment.start();
    assert.equal(environment.appReads, 0);
    assert.equal(environment.calls.length, 0);
    assert.equal(environment.dialog, undefined);
  }
});

test("quietly ignores unavailable, malformed, and older releases", async () => {
  for (const [label, options] of [
    ["offline", { request: async () => { throw new TypeError("offline"); } }],
    ...[403, 404, 500].map((status) => [String(status), { request: async () => ({ ...ok(release()), status, ok: false }) }]),
    ["invalid JSON", { request: async () => ({ ...ok(null), json: async () => { throw new SyntaxError("invalid JSON"); } }) }],
    ["invalid response", { request: async () => ok({ tag_name: "v5.0.0", assets: [] }) }],
    ["invalid installed version", { installed: "development" }],
    ["unavailable installed version", { getInfo: async () => { throw new Error("plugin unavailable"); } }],
    ["same version", { installed: "1.2.0-debug" }],
    ["older version", { version: "1.1.9", installed: "1.2.0" }],
  ]) {
    const environment = fixture(options);
    await environment.start();
    assert.equal(environment.dialog, undefined, label);
    assert.deepEqual([...environment.entries], [], label);
  }
});

test("aborts after five seconds even when the response body is still being read", async () => {
  let deadline;
  let delay;
  let cleared;
  let requestSignal;
  let bodyStarted;
  let completeBody;
  const bodyReaderReady = new Promise((resolve) => { bodyStarted = resolve; });
  const environment = fixture({
    request: async (_url, { signal }) => {
      requestSignal = signal;
      return {
        ...ok(null),
        json: () => new Promise((resolve) => {
          completeBody = resolve;
          bodyStarted();
        }),
      };
    },
    timers: {
      setTimeout: (callback, milliseconds) => { deadline = callback; delay = milliseconds; return 27; },
      clearTimeout: (id) => { cleared = id; },
    },
  });
  const check = environment.start();
  await bodyReaderReady;
  assert.equal(delay, 5000);
  assert.equal(requestSignal.aborted, false);
  deadline();
  await check;
  assert.equal(requestSignal.aborted, true);
  assert.equal(cleared, 27);
  assert.equal(environment.dialog, undefined);
  // A body reader that ignores AbortSignal must still be unable to show a late prompt.
  completeBody(release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(environment.dialog, undefined);
});

test("names and describes the modal, cycles focus, and opens the validated APK", async () => {
  const environment = fixture();
  await environment.start();
  const { dialog, document, trigger } = environment;
  assert.equal(dialog.open, true);
  assert.equal(dialog.getAttribute("role") ?? dialog.tagName.toLowerCase(), "dialog");
  const nodes = [...dialog.walk()];
  const [later, download] = nodes.filter((node) => node.tagName === "BUTTON");
  const title = nodes.find((node) => (node.id ?? node.getAttribute("id")) === dialog.getAttribute("aria-labelledby"));
  const description = nodes.find((node) => (node.id ?? node.getAttribute("id")) === dialog.getAttribute("aria-describedby"));
  assert.equal(title.textContent, "새 버전이 있어요");
  assert.match(description.textContent, /1\.2\.0/);
  assert.equal(later.textContent, "나중에");
  assert.equal(download.textContent, "받기");
  assert.equal(document.activeElement, later);
  assert.equal(dialog.dispatch("keydown", { key: "Tab", shiftKey: true }).defaultPrevented, true);
  assert.equal(document.activeElement, download);
  assert.equal(dialog.dispatch("keydown", { key: "Tab", shiftKey: false }).defaultPrevented, true);
  assert.equal(document.activeElement, later);
  download.dispatch("click");
  assert.deepEqual(environment.downloads, [downloadUrl("1.2.0")]);
  assert.deepEqual([...environment.entries], []);
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(nodes.some((node) => (node.textContent ?? "").includes("테스트용")), false);
});

test("Later and Esc remember only the skipped version and allow a newer prompt", async () => {
  for (const dismiss of ["later", "escape"]) {
    const entries = new Map();
    const environment = fixture({ entries, installed: "0.0.8-debug" });
    await environment.start();
    const { dialog, trigger, document } = environment;
    const nodes = [...dialog.walk()];
    const describedBy = dialog.getAttribute("aria-describedby").split(/\s+/);
    const debugText = nodes.find((node) => /테스트용/.test(node.textContent ?? ""));
    assert.match(debugText.textContent, /지운 뒤 설치/);
    assert.match(debugText.textContent, /대화 기록.*지워/);
    assert.ok(describedBy.includes(debugText.id ?? debugText.getAttribute("id")));
    if (dismiss === "later") {
      nodes.find((node) => node.textContent === "나중에").dispatch("click");
    } else {
      assert.equal(dialog.dispatch("cancel").defaultPrevented, true);
    }
    assert.deepEqual([...entries], [[SKIPPED_VERSION_KEY, "1.2.0"]]);
    assert.deepEqual(environment.downloads, []);
    assert.equal(dialog.open, false);
    assert.equal(document.activeElement, trigger);
    for (const version of ["1.2.0", "1.1.9", "1.2.1"]) {
      const next = fixture({ entries, version });
      await next.start();
      assert.equal(Boolean(next.dialog?.open), version === "1.2.1");
    }
  }
});

test("unavailable storage does not prevent the prompt or dismissal", async () => {
  const environment = fixture({
    storage: {
      getItem() { throw new Error("storage denied"); },
      setItem() { throw new Error("storage denied"); },
    },
  });
  await environment.start();
  const { dialog, trigger, document } = environment;
  assert.equal(dialog.open, true);
  dialog.dispatch("cancel");
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, trigger);
});
