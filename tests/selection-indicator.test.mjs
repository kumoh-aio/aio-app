import test from "node:test";
import assert from "node:assert/strict";
import { createSelectionIndicator, measureIndicator } from "../web/assets/selection-indicator.mjs";

function box(left, width) {
  return { left, right: left + width, width };
}

test("indicator geometry uses fractional edges inside asymmetric borders", () => {
  const container = box(10.25, 150.5);
  const borders = { left: 1.5, right: 2.25 };
  const first = measureIndicator(container, box(14, 43.5), borders);
  assert.deepEqual(first, { left: 2.25, right: 101, direction: "forward" });
  const last = measureIndicator(container, box(64.75, 89.5), borders, first);
  assert.deepEqual(last, { left: 53, right: 4.25, direction: "forward" });
  assert.deepEqual(measureIndicator(container, box(14, 43.5), borders, last),
    { ...first, direction: "back" });
  assert.equal(measureIndicator(box(0, 0), box(14, 43.5), borders), null);
  assert.equal(measureIndicator(container, box(0, 0), borders), null);
});

for (const useObserver of [true, false]) {
  test(`indicator snaps after layout changes (${useObserver ? "observer" : "resize event"})`, () => {
    const attributes = new Map();
    const properties = new Map();
    const flushed = [];
    const observed = [];
    let realign;
    let visible = false;
    let targetWidth = 42.5;
    const win = {
      getComputedStyle(_element, pseudo) {
        if (pseudo === "::before" && attributes.get("data-indicator") === "instant") {
          flushed.push(attributes.get("data-indicator"));
        }
        return { borderLeftWidth: "1px", borderRightWidth: "2px" };
      },
      addEventListener(type, callback) {
        assert.equal(type, "resize");
        realign = callback;
      },
    };
    if (useObserver) {
      win.ResizeObserver = class {
        constructor(callback) { realign = callback; }
        observe(element) { observed.push(element); }
      };
    }
    const container = {
      ownerDocument: { defaultView: win },
      getBoundingClientRect: () => box(20, visible ? 200 : 0),
      setAttribute: (key, value) => attributes.set(key, value),
      removeAttribute: (key) => attributes.delete(key),
      style: { setProperty: (key, value) => properties.set(key, value) },
    };
    const first = { getBoundingClientRect: () => box(21, targetWidth) };
    const second = { getBoundingClientRect: () => box(79, 55) };
    const update = createSelectionIndicator(container, [first, second]);
    if (useObserver) assert.deepEqual(observed, [container, first, second]);

    update(first);
    assert.equal(attributes.has("data-indicator"), false);
    visible = true;
    update(first);
    assert.equal(attributes.get("data-indicator"), "ready");
    assert.equal(properties.get("--indicator-right"), "154.5px");
    assert.deepEqual(flushed, ["instant"]);

    update(second, true);
    update(first, true);
    update(first, true);
    assert.equal(attributes.get("data-indicator-dir"), "back");
    assert.equal(properties.get("--indicator-left"), "0px");
    assert.deepEqual(flushed, ["instant"]);

    realign();
    assert.deepEqual(flushed, ["instant"]);
    targetWidth = 61;
    realign();
    assert.equal(properties.get("--indicator-right"), "136px");
    assert.equal(attributes.get("data-indicator-dir"), "back");
    assert.deepEqual(flushed, ["instant", "instant"]);
  });
}

test("tab retargeting follows the current rendered edge during a transition", () => {
  const attributes = new Map();
  const properties = new Map();
  let renderedLeft = "auto";
  const win = {
    getComputedStyle(_element, pseudo) {
      return pseudo === "::before" ? { left: renderedLeft } : {};
    },
    addEventListener() {},
  };
  const container = {
    ownerDocument: { defaultView: win },
    getBoundingClientRect: () => box(0, 320),
    setAttribute: (name, value) => attributes.set(name, value),
    style: { setProperty: (name, value) => properties.set(name, value) },
  };
  const tabs = Array.from({ length: 5 }, (_, index) => ({
    getBoundingClientRect: () => box(index * 64, 64),
  }));
  const [home, , , calendar, more] = tabs;
  const update = createSelectionIndicator(container, tabs);

  // At the first frame and 15 ms later, the trailing edge is still at home.
  for (const sample of ["first frame", "15 ms"]) {
    update(home);
    renderedLeft = "0px";
    update(more, true);
    update(calendar, true);
    assert.equal(attributes.get("data-indicator-dir"), "forward", sample);
    assert.equal(properties.get("--indicator-left"), "192px");
    assert.equal(properties.get("--indicator-right"), "64px");
  }

  update(more);
  renderedLeft = "256px";
  update(home, true);
  renderedLeft = "224.5px";
  update(calendar, true);
  assert.equal(attributes.get("data-indicator-dir"), "back");
});
