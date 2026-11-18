import { test } from "node:test";
import assert from "node:assert/strict";
import { arcLayout, nextIndex, createQuickActions } from "../web/assets/quick-actions.mjs";

test("320px and both edges keep three and four bubbles within the viewport and apart", () => {
  for (const width of [320, 390, 1024]) {
    for (const x of [24, width / 2, width - 24]) {
      for (const count of [3, 4]) {
        const points = arcLayout({ origin: { x, y: 600 }, viewport: { width, height: 700 }, size: 48, gap: 16, count });
        assert.equal(points.length, count);
        points.forEach((point, index) => {
          assert.ok(point.x >= 24 && point.x <= width - 24);
          assert.ok(point.y >= 24 && point.y <= 676);
          assert.ok(point.y <= 600);
          for (const other of points.slice(index + 1)) assert.ok(Math.hypot(point.x - other.x, point.y - other.y) >= 64 - 1e-8);
        });
      }
    }
  }
});

test("keyboard navigation wraps and Home/End select endpoints", () => {
  for (const key of ["ArrowLeft", "ArrowUp"]) assert.equal(nextIndex(key, 0, 4), 3);
  for (const key of ["ArrowRight", "ArrowDown"]) assert.equal(nextIndex(key, 3, 4), 0);
  assert.equal(nextIndex("Home", 2, 4), 0);
  assert.equal(nextIndex("End", 1, 4), 3);
  assert.equal(nextIndex("Enter", 2, 4), 2);
  assert.equal(nextIndex("Home", 0, 0), -1);
  assert.throws(() => arcLayout({ origin: { x: 0, y: 0 }, viewport: { width: 320, height: 640 }, count: -1 }), RangeError);
});

class Node {
  constructor(doc, tag) {
    this.doc = doc;
    this.tagName = tag;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = { setProperty: (key, value) => this.attributes.set(key, value) };
  }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key); }
  append(...nodes) { nodes.forEach((node) => { node.parent = this; this.children.push(node); }); }
  addEventListener(type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  emit(type, options = {}) {
    const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...options };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
  focus() { this.doc.activeElement = this; }
  contains(node) { return this === node || this.children.some((child) => child.contains(node)); }
  closest() { return this.control ? this : null; }
  getBoundingClientRect() { return { left: 0, top: 600, width: 48, height: 48 }; }
}

function setup() {
  const doc = new Node(null, "document");
  doc.body = new Node(doc, "body");
  doc.createElement = (tag) => new Node(doc, tag);
  doc.createElementNS = (_, tag) => new Node(doc, tag);
  doc.defaultView = { innerWidth: 320, innerHeight: 700, addEventListener() {}, matchMedia: () => ({ matches: true }) };
  const selected = [];
  const actions = ["calendar", "graduation", "biskit", "handwriting"].map((id) => ({
    id, label: { ko: `가상 ${id}`, en: `Demo ${id}`, zh: `示例 ${id}` }, run: (value) => selected.push({ id, ...value }),
  }));
  const ring = createQuickActions({ doc, actions });
  const trigger = doc.createElement("button");
  const [svg, items] = ring.element.children;
  return { doc, ring, trigger, svg, items, selected };
}

// 취소하지 않은 pointerdown 뒤에는 호환 mousedown의 기본 포커스 이동이 이어진다.
function outsidePointerSequence(doc, target) {
  const event = doc.emit("pointerdown", { target });
  if (!event.defaultPrevented) {
    doc.emit("mousedown", { target });
    (target.control ? target : doc.body).focus();
  }
  doc.emit("click", { target });
  return event;
}

test("open, arrows, Escape and selection maintain focus and popup state", () => {
  const { doc, ring, trigger, items, selected } = setup();
  assert.equal(ring.element.hidden, true);
  assert.equal(ring.element.inert, true);
  ring.open(trigger, { lang: "en" });
  assert.equal(ring.element.hidden, false);
  assert.equal(ring.element.inert, false);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement, items.children[0]);
  assert.equal(items.children[0].children[1].textContent, "Demo calendar");
  ring.element.emit("keydown", { key: "ArrowLeft" });
  assert.equal(doc.activeElement, items.children[3]);
  ring.element.emit("keydown", { key: "Home" });
  assert.equal(doc.activeElement, items.children[0]);
  ring.element.emit("keydown", { key: "Escape" });
  assert.equal(doc.activeElement, trigger);
  assert.equal(ring.element.hidden, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  ring.open(trigger);
  items.children[2].emit("click");
  assert.equal(selected[0].id, "biskit");
  assert.equal(selected[0].trigger, trigger);
  assert.equal(ring.element.inert, true);
});

test("blank outside returns focus while other controls and Tab retain their destination", async () => {
  const { doc, ring, trigger, items } = setup();
  ring.open(trigger);
  const blankEvent = outsidePointerSequence(doc, doc.createElement("div"));
  assert.equal(doc.activeElement, trigger);
  assert.equal(blankEvent.defaultPrevented, true);
  const other = doc.createElement("button");
  other.control = true;
  ring.open(trigger);
  const controlEvent = outsidePointerSequence(doc, other);
  assert.equal(controlEvent.defaultPrevented, undefined);
  assert.equal(doc.activeElement, other);
  assert.equal(ring.element.inert, true);
  ring.open(trigger);
  ring.element.emit("keydown", { key: "Tab" });
  assert.equal(doc.activeElement, items.children[0]);
  assert.equal(ring.element.inert, false);
  other.focus();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(doc.activeElement, other);
  assert.equal(ring.element.hidden, true);
  ring.open(trigger);
  other.focus();
  doc.emit("focusin", { target: other });
  assert.equal(ring.element.inert, true);
  assert.equal(doc.activeElement, other);
});

test("filtered decoration is separate from menu buttons and coordinates use custom properties", () => {
  const { ring, trigger, svg, items } = setup();
  const group = svg.children[0];
  assert.equal(group.getAttribute("filter"), "url(#aio-goo)");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.getAttribute("pointer-events"), "none");
  assert.equal(ring.element.getAttribute("role"), "menu");
  assert.equal(group.children.length, 4);
  items.children.forEach((button) => {
    assert.equal(group.contains(button), false);
    assert.equal(button.getAttribute("role"), "menuitem");
  });
  ring.open(trigger);
  assert.match(items.children[0].getAttribute("--qa-x"), /px$/);
  assert.match(group.children[0].getAttribute("--qa-y"), /px$/);
});

test("closing transition can be interrupted by reopening", async () => {
  const { doc, ring, trigger } = setup();
  doc.defaultView.matchMedia = () => ({ matches: false });
  ring.open(trigger);
  ring.close();
  assert.equal(ring.element.inert, true);
  assert.equal(ring.element.getAttribute("aria-hidden"), "true");
  assert.equal(ring.element.hidden, false);
  ring.open(trigger);
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(ring.element.hidden, false);
  ring.close();
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(ring.element.hidden, true);
});
