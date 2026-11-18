import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DURATION_MS, SEND_PATH, STOP_PATH, SEND_POINTS, STOP_POINTS,
  easeOut, lerpPoints, pathFromPoints, mountSendIcon,
} from "../web/assets/send-icon.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

class FakeNode {
  constructor(tag, namespace = null) {
    this.tagName = tag;
    this.namespace = namespace;
    this.attributes = new Map();
    this.children = [];
    this.dHistory = [];
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === "d") this.dHistory.push(String(value));
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  appendChild(node) { this.children.push(node); return node; }
}

// 가짜 프레임과 시계. run(t)은 시각을 t로 옮기고 그때까지 요청된 프레임 하나를 실행한다.
function fakeWindow({ reduced = false, raf = true } = {}) {
  let time = 1000;
  let nextId = 1;
  const queue = new Map();
  const cancelled = [];
  const motionListeners = [];
  const motion = {
    matches: reduced,
    addEventListener: (name, listener) => { if (name === "change") motionListeners.push(listener); },
  };
  const win = {
    performance: { now: () => time },
    matchMedia: (query) => (query === "(prefers-reduced-motion: reduce)" ? motion : { matches: false }),
    cancelAnimationFrame: (id) => { cancelled.push(id); queue.delete(id); },
  };
  if (raf) {
    win.requestAnimationFrame = (callback) => {
      const id = nextId++;
      queue.set(id, callback);
      return id;
    };
  }
  return {
    win,
    queue,
    cancelled,
    advance(ms) { time += ms; },
    setReduced(on) {
      motion.matches = on;
      for (const listener of motionListeners) listener({ matches: on });
    },
    run(ms = 0) {
      time += ms;
      const pending = [...queue];
      queue.clear();
      for (const [, callback] of pending) callback(time);
    },
  };
}

function mount(options = {}) {
  const frames = fakeWindow(options);
  const docListeners = [];
  const doc = {
    hidden: Boolean(options.hidden),
    createElementNS: (namespace, tag) => new FakeNode(tag, namespace),
    addEventListener: (name, listener) => { if (name === "visibilitychange") docListeners.push(listener); },
  };
  frames.hide = () => {
    doc.hidden = true;
    for (const listener of docListeners) listener({ type: "visibilitychange" });
  };
  const button = new FakeNode("button");
  const label = new FakeNode("span");
  button.appendChild(label);
  const icon = mountSendIcon(button, { doc, win: frames.win, stopping: options.stopping });
  const svg = button.children[1];
  const path = svg.children[0];
  return { ...frames, doc, button, label, svg, path, icon };
}

const dOf = (points) => pathFromPoints(points);

test("두 경로는 점 7개씩이고 점 배열에서 만든 문자열과 같다", () => {
  assert.equal(SEND_POINTS.length, 7);
  assert.equal(STOP_POINTS.length, 7);
  assert.equal(pathFromPoints(SEND_POINTS), SEND_PATH);
  assert.equal(pathFromPoints(STOP_POINTS), STOP_PATH);
  assert.equal(SEND_PATH, "M12 5 L19 12 L14 12 L14 19 L10 19 L10 12 L5 12 Z");
  assert.equal(STOP_PATH, "M12 7 L17 7 L17 12 L17 17 L7 17 L7 12 L7 7 Z");
  for (const points of [SEND_POINTS, STOP_POINTS]) {
    for (const [x, y] of points) assert.ok(x >= 0 && x <= 24 && y >= 0 && y <= 24, "24×24 안");
  }
  assert.equal(DURATION_MS, 180);
});

test("ease-out 곡선은 1 - (1 - t)^3이고 범위 밖은 끝값으로 자른다", () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.equal(easeOut(0.5), 0.875);
  assert.ok(Math.abs(easeOut(1 / 3) - (1 - (2 / 3) ** 3)) < 1e-12);
  assert.equal(easeOut(-1), 0);
  assert.equal(easeOut(2), 1);
  assert.equal(easeOut(Number.NaN), 1);
  assert.ok(easeOut(0.2) > 0.2, "처음이 빠르다");
});

test("점 보간은 양 끝에서 원래 점이고 중간은 점마다 선형이다", () => {
  assert.deepEqual(lerpPoints(SEND_POINTS, STOP_POINTS, 0), SEND_POINTS.map((p) => [...p]));
  assert.deepEqual(lerpPoints(SEND_POINTS, STOP_POINTS, 1), STOP_POINTS.map((p) => [...p]));
  const mid = lerpPoints(SEND_POINTS, STOP_POINTS, 0.5);
  assert.deepEqual(mid[0], [12, 6]);
  assert.deepEqual(mid[1], [18, 9.5]);
  assert.deepEqual(mid[6], [6, 9.5]);
  assert.throws(() => lerpPoints(SEND_POINTS, STOP_POINTS.slice(1), 0.5), RangeError);
  // 반올림한 -0은 "0"으로 쓴다
  assert.equal(pathFromPoints([[-0.001, 0.004]]), "M0 0 Z");
});

test("버튼에 장식 SVG와 data-icon만 더하고 기존 글자는 그대로 둔다", () => {
  const { button, label, svg, path } = mount();
  assert.equal(button.children.length, 2);
  assert.equal(button.children[0], label);
  assert.equal(button.getAttribute("data-icon"), "morph");
  assert.deepEqual([...button.attributes.keys()], ["data-icon"], "이름·type·data-state는 채팅 모듈이 맡는다");
  assert.equal(svg.tagName, "svg");
  assert.equal(svg.namespace, "http://www.w3.org/2000/svg");
  assert.equal(svg.getAttribute("aria-hidden"), "true");
  assert.equal(svg.getAttribute("focusable"), "false");
  assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(svg.getAttribute("class"), "chat-send-icon");
  assert.equal(path.tagName, "path");
  assert.equal(path.getAttribute("fill"), "currentColor");
  assert.equal(path.getAttribute("d"), SEND_PATH);
});

test("정지로 바뀌면 프레임마다 d를 보간하고 180ms에 정지 모양에서 멈춘다", () => {
  const { icon, path, queue, run } = mount();
  icon.setStopping(true);
  assert.equal(path.getAttribute("d"), SEND_PATH, "첫 프레임 전에는 그대로다");
  assert.equal(queue.size, 1);
  run(90);
  const expected = dOf(lerpPoints(SEND_POINTS, STOP_POINTS, 0.875));
  assert.equal(path.getAttribute("d"), expected);
  assert.ok(expected.startsWith("M12 6.75 L17.25 7.63 "), expected);
  assert.equal(queue.size, 1, "다음 프레임을 요청한다");
  run(90);
  assert.equal(path.getAttribute("d"), STOP_PATH);
  assert.equal(queue.size, 0, "끝나면 프레임을 더 요청하지 않는다");
  run(16);
  assert.equal(path.getAttribute("d"), STOP_PATH);

  icon.setStopping(false);
  run(200);
  assert.equal(path.getAttribute("d"), SEND_PATH, "전송 모양으로 돌아온다");
  assert.equal(queue.size, 0);
});

test("응답 중에 늦게 붙으면 프레임 없이 정지 모양으로 시작하고 거기서 전송으로 돌아간다", () => {
  // 움직임 줄이기 꺼짐, rAF 있음: 화살표 → 중간 → 정지로 보이면 안 된다
  const { icon, path, queue, run } = mount({ stopping: true });
  assert.deepEqual(path.dHistory, [STOP_PATH], "첫 프레임 전부터 정지 모양");
  assert.equal(queue.size, 0);
  icon.setStopping(true);
  assert.equal(queue.size, 0, "같은 상태는 움직이지 않는다");
  run(16);
  assert.deepEqual(path.dHistory, [STOP_PATH]);
  icon.setStopping(false);
  run(90);
  assert.equal(path.getAttribute("d"), dOf(lerpPoints(STOP_POINTS, SEND_POINTS, 0.875)));
  run(90);
  assert.equal(path.getAttribute("d"), SEND_PATH);
});

test("같은 방향을 다시 불러도 움직임을 다시 시작하지 않는다", () => {
  const { icon, path, queue, cancelled, run } = mount();
  icon.setStopping(false);
  assert.equal(queue.size, 0, "이미 전송 모양이면 아무 일도 없다");
  icon.setStopping(true);
  run(60);
  const drawn = path.getAttribute("d");
  icon.setStopping(true);
  assert.deepEqual(cancelled, []);
  assert.equal(queue.size, 1);
  assert.equal(path.getAttribute("d"), drawn);
  run(120);
  assert.equal(path.getAttribute("d"), STOP_PATH);
});

test("도중에 뒤집으면 이전 프레임을 취소하고 그려진 점에서 이어 간다", () => {
  const { icon, path, queue, cancelled, run, advance } = mount();
  icon.setStopping(true);
  run(60);
  const drawnPoints = lerpPoints(SEND_POINTS, STOP_POINTS, easeOut(60 / 180));
  assert.equal(path.getAttribute("d"), dOf(drawnPoints));
  const [pendingId] = queue.keys();
  advance(5);
  icon.setStopping(false);
  assert.deepEqual(cancelled, [pendingId], "진행 중 프레임을 취소한다");
  assert.equal(queue.size, 1, "새 움직임의 프레임 하나만 남는다");
  assert.equal(path.getAttribute("d"), dOf(drawnPoints), "뒤집는 순간 모양이 튀지 않는다");
  run(90); // 새 움직임은 뒤집은 시각부터 180ms다
  assert.equal(path.getAttribute("d"), dOf(lerpPoints(drawnPoints, SEND_POINTS, 0.875)));
  run(90);
  assert.equal(path.getAttribute("d"), SEND_PATH);
  assert.equal(queue.size, 0);
});

test("움직임 줄이기, rAF 없음, 숨은 문서에서는 프레임 없이 바로 바뀐다", () => {
  for (const options of [{ reduced: true }, { raf: false }, { hidden: true }]) {
    const { icon, path, queue } = mount(options);
    icon.setStopping(true);
    assert.equal(path.getAttribute("d"), STOP_PATH, JSON.stringify(options));
    assert.equal(queue.size, 0);
    icon.setStopping(false);
    assert.equal(path.getAttribute("d"), SEND_PATH);
    assert.deepEqual(path.dHistory, [SEND_PATH, STOP_PATH, SEND_PATH], "중간 모양을 그리지 않는다");
  }
});

test("목표를 유지한 채 문서가 숨으면 visibilitychange에서 프레임을 취소하고 정지 모양을 그린다", () => {
  const { icon, path, queue, cancelled, run, hide } = mount();
  icon.setStopping(true);
  run(40);
  assert.notEqual(path.getAttribute("d"), STOP_PATH, "아직 중간 모양");
  const [pendingId] = queue.keys();
  hide(); // setStopping을 다시 부르지 않는다
  assert.deepEqual(cancelled, [pendingId]);
  assert.equal(queue.size, 0, "예약 프레임이 남지 않는다");
  assert.equal(path.getAttribute("d"), STOP_PATH);
  // 숨은 뒤 방향이 바뀌어도 바로 바뀐다
  icon.setStopping(false);
  assert.equal(path.getAttribute("d"), SEND_PATH);
  assert.equal(queue.size, 0);
});

test("움직이는 도중 움직임 줄이기가 켜지면 change에서 바로 목표 모양으로 끝낸다", () => {
  const { icon, path, queue, cancelled, run, setReduced } = mount();
  icon.setStopping(true);
  run(40);
  const [pendingId] = queue.keys();
  setReduced(true);
  assert.deepEqual(cancelled, [pendingId]);
  assert.equal(queue.size, 0);
  assert.equal(path.getAttribute("d"), STOP_PATH);
  icon.setStopping(false);
  assert.equal(path.getAttribute("d"), SEND_PATH, "켜진 뒤에는 처음부터 바로 바뀐다");
  assert.equal(queue.size, 0);
});

test("change 이벤트를 놓쳐도 다음 프레임에서 움직임 줄이기를 다시 보고 목표 모양으로 끝낸다", () => {
  const { icon, path, queue, run, win } = mount();
  icon.setStopping(true);
  run(40);
  win.matchMedia("(prefers-reduced-motion: reduce)").matches = true; // 처리기는 부르지 않는다
  run(16);
  assert.equal(path.getAttribute("d"), STOP_PATH);
  assert.equal(queue.size, 0, "더 프레임을 요청하지 않는다");
});

test("움직임이 없을 때의 숨김·움직임 줄이기 이벤트는 모양을 바꾸지 않는다", () => {
  const { path, hide, setReduced } = mount();
  hide();
  setReduced(true);
  assert.deepEqual(path.dHistory, [SEND_PATH]);
});

test("CSS: 전송 버튼은 44px 정사각이고 아이콘이 붙으면 글자를 시각적으로만 숨긴다", () => {
  const css = read("../web/assets/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const focusAt = css.lastIndexOf(":focus-visible");
  const rule = (selector) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at > 0 && at < focusAt, `${selector}는 포커스 규칙 앞에 있다`);
    return css.slice(at, css.indexOf("}", at));
  };
  const base = rule(".chat-send");
  assert.match(base, /min-width:\s*var\(--touch\)/);
  assert.match(base, /min-height:\s*var\(--touch\)/);
  const icon = rule(".chat-send[data-icon]");
  assert.match(icon, /width:\s*var\(--touch\)/);
  assert.match(icon, /height:\s*var\(--touch\)/);
  const label = rule(".chat-send[data-icon] .chat-send-label");
  assert.match(label, /position:\s*absolute/);
  assert.match(label, /clip-path:\s*inset\(50%\)/);
  assert.doesNotMatch(label, /display:\s*none|visibility:\s*hidden/, "화면 읽기에는 남긴다");
  assert.match(rule('html[data-theme="neumorphic"] .chat-send'), /box-shadow:\s*var\(--shadow-raised\)/);
  assert.ok(css.indexOf("\n.chat-send {") < css.indexOf(".qa-defs {"), "빠른 실행 링 구간 밖에 둔다");
});

test("설계 문서는 웹 화면이 맞출 경로·시간·곡선·이름·상태와 와이어프레임을 한 절에 적는다", () => {
  const design = read("../docs/DESIGN.md").replace(/\r\n/g, "\n");
  const at = design.indexOf("## 아이오 전송·정지 버튼");
  assert.ok(at >= 0, "설계 절");
  const next = design.indexOf("\n## ", at + 1);
  const section = design.slice(at, next === -1 ? undefined : next);
  for (const word of [SEND_PATH, STOP_PATH, `${DURATION_MS}ms`, "1 - (1 - t)^3", "requestAnimationFrame",
    "data-state", "data-icon", "chat-send", "chat-send-label", "\"보내기\"", "\"응답 중단\"",
    "응답을 중단했습니다.", "preventDefault()", "aria-hidden=\"true\"", "focusable=\"false\""]) {
    assert.ok(section.includes(word), word);
  }
  assert.match(section, /```text\n대기[^\n]*↑[^\n]*data-state=send\n응답 중[^\n]*■[^\n]*data-state=stop\n중단 후[^\n]*↑/,
    "전송 → 정지 → 전송 와이어프레임");
});

test("send-icon.mjs는 외부 의존성과 HTML 문자열 삽입을 쓰지 않는다", () => {
  const source = read("../web/assets/send-icon.mjs");
  assert.doesNotMatch(source, /\bimport\b/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|eval\(|new Function|<animate/);
  assert.deepEqual([...source.matchAll(/https?:\/\/[^\s"']+/g)].map(([url]) => url),
    ["http://www.w3.org/2000/svg"], "SVG 이름공간 말고는 주소가 없다");
});
