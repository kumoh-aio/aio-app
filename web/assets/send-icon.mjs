// 아이오 전송 버튼의 ↑ ↔ ■ 모핑. 경로·시간·곡선은 docs/DESIGN.md "아이오 전송·정지 버튼"과 같다.
// CSS d 속성은 iOS Safari가 지원하지 않으므로 requestAnimationFrame마다 d 속성을 바꾼다.
const SVG_NS = "http://www.w3.org/2000/svg";

export const DURATION_MS = 180;
export const SEND_PATH = "M12 5 L19 12 L14 12 L14 19 L10 19 L10 12 L5 12 Z";
export const STOP_PATH = "M12 7 L17 7 L17 12 L17 17 L7 17 L7 12 L7 7 Z";
// 점 순서가 짝이다. 화살표 끝 → 윗변 가운데, 날개 → 윗변 모서리, 기둥 → 옆변 가운데·아래 모서리.
export const SEND_POINTS = Object.freeze([[12, 5], [19, 12], [14, 12], [14, 19], [10, 19], [10, 12], [5, 12]]
  .map((point) => Object.freeze(point)));
export const STOP_POINTS = Object.freeze([[12, 7], [17, 7], [17, 12], [17, 17], [7, 17], [7, 12], [7, 7]]
  .map((point) => Object.freeze(point)));

/** ease-out 1 - (1 - t)^3. 0~1 밖과 숫자가 아닌 값은 끝값으로 자른다. */
export function easeOut(t) {
  const x = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 1;
  return 1 - (1 - x) ** 3;
}

/** 같은 개수의 점을 순서대로 짝지어 선형 보간한다. */
export function lerpPoints(from, to, t) {
  if (from.length !== to.length) throw new RangeError("점 개수가 다르다");
  return from.map(([x, y], i) => [x + (to[i][0] - x) * t, y + (to[i][1] - y) * t]);
}

const formatNumber = (value) => String(Math.round(value * 100) / 100 || 0); // -0도 "0"으로 쓴다

/** 닫힌 경로 문자열. 좌표는 소수 둘째 자리에서 반올림한다. */
export function pathFromPoints(points) {
  return `${points.map(([x, y], i) => `${i ? "L" : "M"}${formatNumber(x)} ${formatNumber(y)}`).join(" ")} Z`;
}

const copyPoints = (points) => points.map(([x, y]) => [x, y]);

/**
 * 버튼에 장식 SVG를 붙이고 { setStopping(on) }을 돌려준다. 버튼의 다른 자식과 속성은 건드리지 않는다.
 * @param {Element} button
 * @param {{ doc?: Document, win?: Window }} [options]
 */
export function mountSendIcon(button, { doc = button.ownerDocument, win = doc?.defaultView } = {}) {
  const svg = doc.createElementNS(SVG_NS, "svg");
  for (const [name, value] of [["class", "chat-send-icon"], ["viewBox", "0 0 24 24"], ["width", "24"],
    ["height", "24"], ["aria-hidden", "true"], ["focusable", "false"]]) svg.setAttribute(name, value);
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", SEND_PATH);
  svg.appendChild(path);
  button.appendChild(svg);
  button.setAttribute("data-icon", "morph");

  let drawn = copyPoints(SEND_POINTS);
  let target = SEND_POINTS;
  let frame = null;
  const clock = () => win?.performance?.now?.() ?? Date.now();

  function draw(points) {
    drawn = points;
    path.setAttribute("d", pathFromPoints(points));
  }

  function cancelFrame() {
    if (frame === null) return;
    win?.cancelAnimationFrame?.(frame);
    frame = null;
  }

  const motion = win?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;

  function instant() {
    return typeof win?.requestAnimationFrame !== "function"
      || Boolean(doc.hidden)
      || Boolean(motion?.matches);
  }

  // 움직이는 도중 문서가 숨거나 움직임 줄이기가 켜지면 남은 프레임을 버리고 목표 모양을 바로 그린다.
  // 숨은 문서에서는 rAF가 멈추므로 다음 프레임을 기다리지 않고 이벤트에서 끝낸다.
  function settle() {
    if (frame === null || !instant()) return;
    cancelFrame();
    draw(copyPoints(target));
  }
  doc.addEventListener?.("visibilitychange", settle);
  motion?.addEventListener?.("change", settle);

  function setStopping(on) {
    const next = on ? STOP_POINTS : SEND_POINTS;
    if (next === target) return; // 같은 방향이면 진행 중인 움직임을 그대로 둔다
    target = next;
    cancelFrame();
    if (instant()) {
      draw(copyPoints(next));
      return;
    }
    // 도중에 뒤집어도 지금 그려진 점에서 새 목표로 다시 출발한다.
    const from = drawn;
    const start = clock();
    const step = (now) => {
      frame = null;
      const t = Math.min(1, Math.max(0, ((Number.isFinite(now) ? now : clock()) - start) / DURATION_MS));
      if (t >= 1 || instant()) {
        draw(copyPoints(next));
        return;
      }
      draw(lerpPoints(from, next, easeOut(t)));
      frame = win.requestAnimationFrame(step);
    };
    frame = win.requestAnimationFrame(step);
  }

  return { setStopping };
}
