const SVG_NS = "http://www.w3.org/2000/svg";
const MENU_NAMES = { ko: "빠른 실행", en: "Quick actions", zh: "快捷操作" };

/** Viewport coordinates for an upward arc. Search narrower arcs at screen edges. */
export function arcLayout({ origin, viewport, size = 48, gap = 12, count }) {
  if (!Number.isInteger(count) || count < 0 || count > 6 || size < 44 || gap < 0
    || ![origin?.x, origin?.y, viewport?.width, viewport?.height, size, gap].every(Number.isFinite)) {
    throw new RangeError("invalid quick action geometry");
  }
  if (!count) return [];
  const inset = size / 2 + 8;
  for (let span = 180; span >= 20; span -= 2) {
    const radians = span * Math.PI / 180;
    const minimum = count === 1 ? size + gap : (size + gap) / (2 * Math.sin(radians / (count - 1) / 2));
    for (let start = -180; start <= -span; start += 2) {
      const directions = Array.from({ length: count }, (_, index) => {
        const angle = (start + (count === 1 ? span / 2 : span * index / (count - 1))) * Math.PI / 180;
        return { x: Math.cos(angle), y: Math.sin(angle) };
      });
      let lower = Math.max(size + gap, minimum);
      let upper = Infinity;
      for (const direction of directions) {
        for (const [axis, extent] of [["x", viewport.width], ["y", viewport.height]]) {
          const delta = direction[axis];
          if (Math.abs(delta) < 1e-10) {
            if (origin[axis] < inset || origin[axis] > extent - inset) upper = -1;
            continue;
          }
          const first = (inset - origin[axis]) / delta;
          const last = (extent - inset - origin[axis]) / delta;
          lower = Math.max(lower, Math.min(first, last));
          upper = Math.min(upper, Math.max(first, last));
        }
      }
      if (lower <= upper) return directions.map((direction) => ({
        x: origin.x + lower * direction.x,
        y: origin.y + lower * direction.y,
      }));
    }
  }
  // A very short viewport can have no upward arc. Keep every control reachable.
  const columns = Math.max(1, Math.floor((viewport.width - 16 + gap) / (size + gap)));
  return Array.from({ length: count }, (_, index) => ({
    x: inset + (index % columns) * (size + gap),
    y: inset + (viewport.height >= size + 60 ? 22 : 0) + Math.floor(index / columns) * (size + gap),
  }));
}

function placeLabels(points, dimensions, viewport, size) {
  const radius = size / 2;
  const margin = 4;
  const bubbles = points.map(({ x, y }) => ({ x: x - radius, y: y - radius, width: size, height: size }));
  const placed = [];
  const fits = (label, obstacles) => label.y >= margin && label.y + label.height <= viewport.height - margin
    && obstacles.every((box) => label.x + label.width + margin <= box.x || box.x + box.width + margin <= label.x
      || label.y + label.height + margin <= box.y || box.y + box.height + margin <= label.y);

  return points.map((point, index) => {
    const { width, height } = dimensions[index];
    const clampX = (x) => Math.max(margin, Math.min(x, viewport.width - margin - width));
    const center = clampX(point.x - width / 2);
    const obstacles = [...bubbles, ...placed];
    const xs = [center, ...obstacles.flatMap((box) => [clampX(box.x - width - margin), clampX(box.x + box.width + margin)])];
    const above = point.y - radius - margin - height;
    const below = point.y + radius + margin;
    const ys = [above, below, ...obstacles.flatMap((box) => [box.y - height - margin, box.y + box.height + margin])];
    let best;
    let distance = Infinity;
    for (const y of ys) {
      for (const x of xs) {
        const candidate = { x, y, width, height };
        const offset = Math.hypot(x - center, y + height / 2 - point.y);
        if (offset >= distance || !fits(candidate, obstacles)) continue;
        best = candidate;
        distance = offset;
      }
    }
    if (best) placed.push(best);
    return best ?? { x: center, y: above >= margin ? above : below };
  });
}

export function nextIndex(key, index, count) {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowLeft" || key === "ArrowUp") return (index - 1 + count) % count;
  if (key === "ArrowRight" || key === "ArrowDown") return (index + 1) % count;
  return index;
}

/** The caller attaches element once and supplies existing application actions. */
export function createQuickActions({ doc, actions }) {
  const element = doc.createElement("div");
  element.id = "aio-quick-actions";
  element.setAttribute("id", element.id);
  element.className = "qa-ring";
  element.setAttribute("role", "menu");
  element.setAttribute("data-open", "false");
  element.setAttribute("aria-hidden", "true");
  element.hidden = true;
  element.inert = true;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "qa-goo");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("pointer-events", "none");
  const group = doc.createElementNS(SVG_NS, "g");
  group.setAttribute("filter", "url(#aio-goo)");
  svg.append(group);
  const items = doc.createElement("div");
  items.className = "qa-items";
  element.append(svg, items);
  let trigger = null;
  let opened = false;
  let hideTimer;
  let tabTimer;
  let index = 0;
  const blobs = [];
  const labels = [];
  const buttons = actions.map((action) => {
    const blob = doc.createElementNS(SVG_NS, "circle");
    blob.setAttribute("class", "qa-blob");
    blob.setAttribute("r", "24");
    blob.setAttribute("cx", "0");
    blob.setAttribute("cy", "0");
    group.append(blob);
    blobs.push(blob);
    const button = doc.createElement("button");
    button.className = "qa-item";
    button.setAttribute("type", "button");
    button.setAttribute("role", "menuitem");
    button.setAttribute("data-action", action.id);
    button.tabIndex = -1;
    const icon = doc.createElement("span");
    icon.className = "qa-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = { calendar: "▦", graduation: "◇", biskit: "B", handwriting: "✎" }[action.id] ?? "";
    const label = doc.createElement("span");
    label.className = "qa-label";
    labels.push(label);
    button.append(icon, label);
    button.addEventListener("click", () => {
      const source = trigger;
      close(false);
      action.run?.({ trigger: source });
    });
    items.append(button);
    return button;
  });

  function close(restoreFocus = false) {
    if (!opened) return;
    opened = false;
    clearTimeout(tabTimer);
    element.setAttribute("data-open", "false");
    element.setAttribute("aria-hidden", "true");
    element.inert = true;
    if (doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) element.hidden = true;
    else hideTimer = setTimeout(() => { if (!opened) element.hidden = true; }, 240);
    trigger?.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger?.focus();
  }

  function position() {
    if (!opened) return;
    const rect = trigger.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const win = doc.defaultView;
    const viewport = { width: win?.innerWidth ?? doc.documentElement.clientWidth, height: win?.innerHeight ?? doc.documentElement.clientHeight };
    element.style.setProperty("--qa-origin-x", `${origin.x}px`);
    element.style.setProperty("--qa-origin-y", `${origin.y}px`);
    svg.setAttribute("viewBox", `${-origin.x} ${-origin.y} ${viewport.width} ${viewport.height}`);
    const size = 48;
    const points = arcLayout({ origin, viewport, size, gap: 16, count: buttons.length });
    const dimensions = labels.map((label) => ({ width: label.offsetWidth || 88, height: label.offsetHeight || 22 }));
    const boxes = placeLabels(points, dimensions, viewport, size);
    points.forEach((point, i) => {
      for (const node of [buttons[i], blobs[i]]) {
        node.style.setProperty("--qa-x", `${point.x - origin.x}px`);
        node.style.setProperty("--qa-y", `${point.y - origin.y}px`);
      }
      buttons[i].style.setProperty("--qa-label-x", `${boxes[i].x - point.x}px`);
      buttons[i].style.setProperty("--qa-label-y", `${boxes[i].y - point.y}px`);
    });
  }

  function open(source, { lang = "ko" } = {}) {
    if (!buttons.length) return;
    trigger = source;
    clearTimeout(hideTimer);
    clearTimeout(tabTimer);
    opened = true;
    element.hidden = false;
    element.inert = false;
    element.setAttribute("aria-hidden", "false");
    element.setAttribute("aria-label", MENU_NAMES[lang] ?? MENU_NAMES.ko);
    labels.forEach((label, i) => { label.textContent = actions[i].label[lang] ?? actions[i].label.ko; });
    trigger.setAttribute("aria-expanded", "true");
    position();
    element.getBoundingClientRect(); // Commit the closed geometry before the CSS transition.
    element.setAttribute("data-open", "true");
    index = 0;
    buttons.forEach((button, i) => { button.tabIndex = i === index ? 0 : -1; });
    buttons[0].focus();
  }

  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") tabTimer = setTimeout(() => close(false), 0);
    else if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const focused = buttons.indexOf(doc.activeElement);
      index = nextIndex(event.key, focused >= 0 ? focused : index, buttons.length);
      buttons.forEach((button, i) => { button.tabIndex = i === index ? 0 : -1; });
      buttons[index].focus();
    }
  });
  doc.addEventListener("pointerdown", (event) => {
    if (!opened || element.contains(event.target) || trigger.contains(event.target)) return;
    const control = event.target.closest?.("button, a[href], input, textarea, select, summary, [tabindex], [contenteditable='true']");
    // 빈 곳의 후속 mousedown 기본 동작이 복귀한 포커스를 body로 옮기지 않게 한다.
    if (!control) event.preventDefault();
    close(!control);
  });
  doc.addEventListener("focusin", (event) => {
    if (opened && !element.contains(event.target) && !trigger.contains(event.target)) close(false);
  });
  doc.defaultView?.addEventListener("resize", position);
  doc.defaultView?.addEventListener("scroll", position, true);
  return { element, open, close, toggle(source, options) { if (opened) close(true); else open(source, options); } };
}
