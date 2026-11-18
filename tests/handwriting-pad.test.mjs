import test from "node:test";
import assert from "node:assert/strict";
import { createHandwritingPad } from "../web/assets/handwriting-pad.mjs";
import {
  toLogicalPoint, acceptsPointer, pressureWidth, inkBounds, exportSize,
} from "../web/assets/handwriting-geometry.mjs";

const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.className = "";
    this.disabled = false;
    this.open = false;
    this.width = 300;
    this.height = 150;
    this.clientWidth = 600;
    this.clientHeight = 240;
    this.textContent = "";
    this.context = {
      calls: [],
      setTransform: (...args) => this.context.calls.push(["setTransform", ...args]),
      clearRect: (...args) => this.context.calls.push(["clearRect", ...args]),
      fillRect: (...args) => this.context.calls.push(["fillRect", this.context.fillStyle, ...args]),
      beginPath() {}, moveTo() {}, lineTo() {}, arc() {}, fill() {}, stroke() {},
      save() {}, restore() {}, scale() {}, translate() {},
    };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  remove() { this.ownerDocument.body.children = this.ownerDocument.body.children.filter((child) => child !== this); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== listener));
  }
  dispatch(type, values = {}) {
    const event = { type, target: this, pointerId: 1, pointerType: "pen", clientX: 80, clientY: 80,
      pressure: 0.5, button: 0, preventDefault() { this.defaultPrevented = true; }, ...values };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    if (type === "pointerup" || type === "pointercancel") this.captured = null;
    return event;
  }
  click() { if (!this.disabled) this.dispatch("click"); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; this.focus(); }
  close() { this.open = false; this.dispatch("close"); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 240, right: 600, bottom: 240 }; }
  setPointerCapture(id) { this.captured = id; }
  releasePointerCapture(id) { if (this.captured === id) this.captured = null; }
  hasPointerCapture(id) { return this.captured === id; }
  getContext() { return this.context; }
  toBlob(callback, type) {
    const size = this.ownerDocument.blobSizes.shift() ?? 128;
    callback(new Blob([new Uint8Array(size)], { type }));
  }
  *walk() { yield this; for (const child of this.children) yield* child.walk(); }
  querySelector(selector) {
    return [...this.walk()].find((node) => selector.startsWith(".")
      ? node.className.split(" ").includes(selector.slice(1))
      : node.getAttribute("data-handwriting-action") === /="(.*?)"/.exec(selector)?.[1]) ?? null;
  }
}

function fixture(recognize = async () => "가상 인식 글") {
  const doc = { activeElement: null, blobSizes: [], canvases: [] };
  const win = new FakeElement(doc, "window");
  win.devicePixelRatio = 2;
  win.getComputedStyle = () => ({ getPropertyValue: () => "#0A2540", color: "#0A2540" });
  win.ResizeObserver = class {
    constructor(callback) { doc.resize = callback; }
    observe() {}
    disconnect() {}
  };
  doc.defaultView = win;
  doc.createElement = (tag) => {
    const element = new FakeElement(doc, tag);
    if (tag === "canvas") doc.canvases.push(element);
    return element;
  };
  doc.body = doc.createElement("body");
  doc.documentElement = doc.createElement("html");
  doc.addEventListener = (...args) => win.addEventListener(...args);
  doc.removeEventListener = (...args) => win.removeEventListener(...args);
  const trigger = doc.createElement("button");
  const inserted = [];
  const pad = createHandwritingPad({ doc, recognize });
  const open = (lang = "ko") => pad.open({ trigger, lang, onInsert: (text) => inserted.push(text) });
  open();
  const dialog = doc.body.querySelector(".handwriting-pad");
  const canvas = dialog.querySelector(".handwriting-canvas");
  const status = dialog.querySelector(".handwriting-status");
  const action = (name) => dialog.querySelector(`[data-handwriting-action="${name}"]`);
  const draw = (pointerType = "pen", pointerId = 1) => {
    canvas.dispatch("pointerdown", { pointerType, pointerId });
    canvas.dispatch("pointermove", { pointerType, pointerId, clientX: 160, clientY: 110 });
    canvas.dispatch("pointerup", { pointerType, pointerId, clientX: 180, clientY: 120 });
  };
  return { doc, win, trigger, pad, open, dialog, canvas, status, action, draw, inserted };
}

test("손글씨 성공은 PNG와 언어를 넘기고 인식 글만 삽입한다", async () => {
  const requests = [];
  const f = fixture(async (request) => { requests.push(request); return "가상 인식 글"; });
  f.draw();
  assert.equal(f.canvas.captured, null);
  f.action("insert").click();
  await tick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].image.type, "image/png");
  assert.equal(requests[0].lang, "ko");
  assert.ok(requests[0].signal instanceof AbortSignal);
  assert.deepEqual(f.inserted, ["가상 인식 글"]);
  assert.equal(f.dialog.open, false);
  const exported = f.doc.canvases.slice(1);
  assert.ok(exported.length > 0);
  assert.ok(exported.every((canvas) => Math.max(canvas.width, canvas.height) <= 1024));
  assert.ok(exported.some((canvas) => canvas.context.calls.some(([method, color]) => method === "fillRect" && /^(#fff(?:fff)?|white)$/i.test(color))));
});

for (const status of [422, 503]) {
  test(`${status} 오류 뒤 획을 보존하고 다시 시도한다`, async () => {
    let calls = 0;
    const f = fixture(async () => {
      if (++calls === 1) throw Object.assign(new Error("비공개 서버 본문"), { status });
      return "가상 재시도 글";
    });
    f.draw();
    f.action("insert").click();
    await tick();
    assert.equal(f.dialog.open, true);
    assert.ok(f.status.textContent.length > 0);
    assert.ok(!f.status.textContent.includes("비공개 서버 본문"));
    assert.equal(f.action("insert").disabled, false);
    f.action("insert").click();
    await tick();
    assert.equal(calls, 2);
    assert.deepEqual(f.inserted, ["가상 재시도 글"]);
  });
}

test("인식 중 중복 요청을 막고 닫으면 중단하며 늦은 응답을 버린다", async () => {
  let resolve;
  let request;
  let calls = 0;
  const f = fixture((value) => {
    request = value;
    calls += 1;
    return new Promise((done) => { resolve = done; });
  });
  f.draw();
  f.action("insert").click();
  await tick();
  f.action("insert").click();
  assert.equal(calls, 1);
  assert.equal(f.action("insert").disabled, true);
  f.pad.close();
  assert.equal(request.signal.aborted, true);
  f.open("en");
  resolve("늦게 온 가상 글");
  await tick();
  assert.deepEqual(f.inserted, []);
  assert.equal(f.dialog.open, true);
});

test("Esc와 취소로 닫으면 펜 버튼에 포커스를 돌린다", () => {
  const f = fixture();
  const event = f.dialog.dispatch("cancel");
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.activeElement, f.trigger);
  f.open();
  f.action("cancel").click();
  assert.equal(f.dialog.open, false);
  assert.equal(f.doc.activeElement, f.trigger);
});

test("이전 dialog의 지연된 close 이벤트가 다시 연 패드를 닫지 않는다", () => {
  const f = fixture();
  f.pad.close();
  f.open();
  f.dialog.dispatch("close");
  assert.equal(f.dialog.open, true);
  f.draw();
  assert.equal(f.action("insert").disabled, false);
});

test("첫 펜을 보면 진행 중인 터치 획을 버리고 이후 터치를 무시한다", async () => {
  let request;
  const f = fixture(async (value) => { request = value; return "가상 글"; });
  f.canvas.dispatch("pointerdown", { pointerType: "touch", pointerId: 2 });
  f.canvas.dispatch("pointermove", { pointerType: "touch", pointerId: 2, clientX: 500 });
  f.draw("pen", 3);
  f.action("undo").click();
  f.draw("touch", 4);
  assert.equal(f.action("insert").disabled, true);
  f.action("insert").click();
  await tick();
  assert.equal(request, undefined);
  f.pad.close();
  f.open();
  f.draw("touch", 4);
  assert.equal(f.action("insert").disabled, false);
});

test("크기가 넘는 PNG는 축소해서 다시 인코딩한다", async () => {
  let request;
  const f = fixture(async (value) => { request = value; return "가상 글"; });
  f.doc.blobSizes.push(2_000_001, 400);
  f.draw();
  f.action("insert").click();
  await tick();
  assert.equal(request.image.size, 400);
  assert.ok(f.doc.canvases.at(-1).width < f.doc.canvases[1].width);
});

test("화면 좌표는 DPR과 화면 크기를 반영한 CSS 논리 좌표로 변환한다", () => {
  assert.deepEqual(toLogicalPoint({ clientX: 210, clientY: 120 }, { left: 10, top: 20, width: 400, height: 200 },
    { width: 1600, height: 800, dpr: 2 }), { x: 400, y: 200 });
});

test("손바닥 판정과 압력 굵기는 입력 종류와 범위를 반영한다", () => {
  assert.equal(acceptsPointer("touch", false), true);
  assert.equal(acceptsPointer("touch", true), false);
  assert.equal(acceptsPointer("pen", true), true);
  assert.equal(acceptsPointer("mouse", true), true);
  assert.ok(pressureWidth(1) > pressureWidth(0));
  assert.equal(pressureWidth(-1), pressureWidth(0));
  assert.equal(pressureWidth(2), pressureWidth(1));
  assert.ok(Number.isFinite(pressureWidth(NaN)));
  assert.equal(pressureWidth(0, "touch"), pressureWidth(1, "touch"));
});

test("잉크 범위는 점의 반지름과 여백을 포함하고 내보내기는 1024px 이하다", () => {
  assert.equal(inkBounds([]), null);
  const bounds = inkBounds([{ points: [{ x: 10, y: 20, width: 4 }, { x: 100, y: 50, width: 8 }] }], 10);
  assert.deepEqual(bounds, { x: -2, y: 8, width: 116, height: 56 });
  assert.deepEqual(exportSize({ width: 2000, height: 1000 }), { width: 1024, height: 512 });
  assert.deepEqual(exportSize({ width: 40, height: 20 }), { width: 40, height: 20 });
  assert.deepEqual(exportSize({ width: 0.1, height: 0.1 }), { width: 1, height: 1 });
});

test("합쳐진 포인터 이벤트를 그리고 크기 변경 뒤에도 획을 내보낸다", async () => {
  let calls = 0;
  const f = fixture(async () => { calls += 1; return "가상 글"; });
  f.canvas.dispatch("pointerdown");
  assert.equal(f.canvas.captured, 1);
  f.canvas.dispatch("pointermove", {
    getCoalescedEvents: () => [{ clientX: 200, clientY: 100, pressure: 0.2 }, { clientX: 250, clientY: 110, pressure: 0.9 }],
  });
  f.canvas.dispatch("pointerup");
  f.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 600 });
  f.doc.resize();
  f.action("insert").click();
  await tick();
  assert.equal(calls, 1);
  assert.ok(f.doc.canvases[1].width >= 200);
});

test("600×240에서 240×600으로 바꾼 뒤 그린 정사각 획은 PNG에서도 정사각형이다", async () => {
  const f = fixture();
  f.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 600 });
  f.doc.resize();
  f.canvas.dispatch("pointerdown", { clientX: 20, clientY: 20 });
  f.canvas.dispatch("pointermove", { clientX: 120, clientY: 20 });
  f.canvas.dispatch("pointermove", { clientX: 120, clientY: 120 });
  f.canvas.dispatch("pointermove", { clientX: 20, clientY: 120 });
  f.canvas.dispatch("pointerup", { clientX: 20, clientY: 20 });
  f.action("insert").click();
  await tick();
  const png = f.doc.canvases[1];
  assert.equal(png.width, png.height);
  assert.ok(png.width > 100, "획 굵기와 여백도 포함한다");
  assert.equal(f.canvas.width, 480);
  assert.equal(f.canvas.height, 1200);
});

test("세 언어 상태와 고정 오류 문구를 제공한다", async () => {
  for (const lang of ["ko", "en", "zh"]) {
    const f = fixture(async () => { throw Object.assign(new Error("서버 원문"), { status: 422 }); });
    f.pad.close();
    f.open(lang);
    const ready = f.status.textContent;
    f.draw();
    f.action("insert").click();
    await tick();
    assert.notEqual(f.status.textContent, ready);
    assert.ok(!f.status.textContent.includes("서버 원문"));
    assert.equal(f.status.getAttribute("aria-live"), "polite");
    f.pad.close();
  }
});

test("APK 뒤로 가기 리스너를 패드가 열린 동안에만 켠다", async () => {
  const previous = globalThis.Capacitor;
  const events = [];
  let back;
  globalThis.Capacitor = {
    getPlatform: () => "android",
    Plugins: { App: {
      async addListener(name, listener) {
        events.push(name);
        back = listener;
        return { async remove() { events.push("remove"); } };
      },
      async toggleBackButtonHandler({ enabled }) { events.push(enabled); },
    } },
  };
  try {
    const f = fixture();
    await tick();
    assert.deepEqual(events, ["backButton", true]);
    back();
    await tick();
    assert.deepEqual(events, ["backButton", true, "remove", false]);
    assert.equal(f.dialog.open, false);
    assert.equal(f.doc.activeElement, f.trigger);
    f.open();
    f.pad.close();
    await tick();
    assert.deepEqual(events, ["backButton", true, "remove", false]);
  } finally {
    if (previous === undefined) delete globalThis.Capacitor;
    else globalThis.Capacitor = previous;
  }
});
