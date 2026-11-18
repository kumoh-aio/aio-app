import { toLogicalPoint, acceptsPointer, pressureWidth, inkBounds, exportSize } from "./handwriting-geometry.mjs";

export const HANDWRITING_TEXT = {
  ko: { title: "손글씨로 입력", canvas: "손글씨 필기 영역", ready: "펜이나 손가락으로 써 주세요.", undo: "획 되돌리기", clear: "지우기", cancel: "취소", insert: "넣기", reading: "손글씨를 읽고 있어요.", format: "PNG 이미지 크기와 형식을 확인해 주세요.", empty: "읽을 글씨가 없어요. 다시 써 주세요.", unavailable: "지금은 손글씨를 읽을 수 없어요. 잠시 뒤 다시 시도해 주세요.", failed: "손글씨를 읽지 못했어요. 다시 시도해 주세요." },
  en: { title: "Handwriting input", canvas: "Handwriting area", ready: "Write with a pen or finger.", undo: "Undo stroke", clear: "Clear", cancel: "Cancel", insert: "Insert", reading: "Reading handwriting…", format: "Check the PNG image size and format.", empty: "No handwriting found. Please write again.", unavailable: "Handwriting is unavailable. Please try again later.", failed: "Could not read handwriting. Please try again." },
  zh: { title: "手写输入", canvas: "手写区域", ready: "请用笔或手指书写。", undo: "撤销笔画", clear: "清除", cancel: "取消", insert: "插入", reading: "正在识别手写内容。", format: "请检查 PNG 图片的大小和格式。", empty: "未找到可识别的文字，请重新书写。", unavailable: "暂时无法识别手写内容，请稍后重试。", failed: "无法识别手写内容，请重试。" },
};

function drawStrokes(context, strokes) {
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const { points } of strokes) {
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const previous = points[Math.max(0, i - 1)];
      context.lineWidth = (previous.width + point.width) / 2;
      context.beginPath();
      if (i === 0) {
        context.arc(point.x, point.y, point.width / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        context.moveTo(previous.x, previous.y);
        context.lineTo(point.x, point.y);
        context.stroke();
      }
    }
  }
}

export async function exportHandwriting(doc, strokes) {
  const bounds = inkBounds(strokes);
  if (!bounds) throw Object.assign(new Error("empty handwriting"), { status: 422 });
  let size = exportSize(bounds);
  while (true) {
    const canvas = doc.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.scale(size.width / bounds.width, size.height / bounds.height);
    context.translate(-bounds.x, -bounds.y);
    context.fillStyle = "#000000";
    context.strokeStyle = "#000000";
    drawStrokes(context, strokes);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG encoding failed");
    if (blob.size <= 2_000_000) return blob;
    if (size.width === 1 && size.height === 1) throw Object.assign(new Error("PNG too large"), { status: 413 });
    size = { width: Math.max(1, Math.floor(size.width * 0.75)), height: Math.max(1, Math.floor(size.height * 0.75)) };
  }
}

export function createHandwritingPad({ doc, recognize }) {
  const win = doc.defaultView || globalThis;
  const dialog = doc.createElement("dialog");
  dialog.className = "handwriting-pad";
  dialog.setAttribute("aria-labelledby", "handwriting-title");
  const title = doc.createElement("h2");
  title.id = "handwriting-title";
  const canvas = doc.createElement("canvas");
  canvas.className = "handwriting-canvas";
  canvas.style.touchAction = "none";
  const status = doc.createElement("p");
  status.className = "handwriting-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const actions = doc.createElement("div");
  actions.className = "handwriting-actions";
  const buttons = {};
  for (const action of ["undo", "clear", "cancel", "insert"]) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("data-handwriting-action", action);
    buttons[action] = button;
    actions.appendChild(button);
  }
  dialog.appendChild(title);
  dialog.appendChild(canvas);
  dialog.appendChild(status);
  dialog.appendChild(actions);
  doc.body.appendChild(dialog);

  let strokes = [];
  let active = null;
  let penSeen = false;
  let opened = false;
  let busy = false;
  let session = 0;
  let controller;
  let options;
  let text = HANDWRITING_TEXT.ko;
  let dpr = 1;
  let logicalWidth = 1;
  let logicalHeight = 1;
  let nativeQueue = Promise.resolve();

  function refresh() {
    buttons.undo.disabled = busy || strokes.length === 0;
    buttons.clear.disabled = busy || strokes.length === 0;
    buttons.insert.disabled = busy || strokes.length === 0 || Boolean(active);
    dialog.setAttribute("aria-busy", String(busy));
  }

  function redraw() {
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    const color = win.getComputedStyle?.(canvas).color || "#0A2540";
    context.strokeStyle = color;
    context.fillStyle = color;
    drawStrokes(context, strokes);
  }

  function resize() {
    if (!opened) return;
    const triggerRect = options?.trigger?.getBoundingClientRect?.();
    const dialogRect = dialog.getBoundingClientRect?.();
    if (triggerRect && dialogRect && dialog.style.setProperty) {
      const top = Math.max(16, triggerRect.top - dialogRect.height - 8);
      const left = Math.max(16, Math.min(triggerRect.right - dialogRect.width, win.innerWidth - dialogRect.width - 16));
      dialog.style.setProperty("--handwriting-top", `${top}px`);
      dialog.style.setProperty("--handwriting-left", `${left}px`);
    }
    const rect = canvas.getBoundingClientRect();
    logicalWidth = Math.max(logicalWidth, rect.width);
    logicalHeight = Math.max(logicalHeight, rect.height);
    dpr = win.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(logicalWidth * dpr));
    canvas.height = Math.max(1, Math.round(logicalHeight * dpr));
    redraw();
  }

  // 직렬화하여 빠르게 닫고 다시 열어도 이전 리스너의 해제가 새 리스너를 건드리지 않는다.
  function nativeOpen(token) {
    nativeQueue = nativeQueue.catch(() => {}).then(async () => {
      const capacitor = globalThis.Capacitor;
      if (capacitor?.getPlatform?.() !== "android") return;
      const app = capacitor.Plugins?.App || capacitor.registerPlugin?.("App");
      if (!app || !opened || token !== session) return;
      const listener = await app.addListener("backButton", () => close());
      try {
        if (opened && token === session) await app.toggleBackButtonHandler({ enabled: true });
        else await listener.remove();
      } catch {
        await listener.remove();
        return;
      }
      return { app, listener };
    }).catch(() => {});
  }

  function nativeClose() {
    nativeQueue = nativeQueue.catch(() => {}).then(async (native) => {
      if (!native) return;
      try { await native.listener.remove(); }
      finally { await native.app.toggleBackButtonHandler({ enabled: false }); }
    }).catch(() => {});
  }

  function finish(restoreFocus) {
    if (!opened) return;
    opened = false;
    session += 1;
    controller?.abort();
    controller = null;
    busy = false;
    active = null;
    strokes = [];
    penSeen = false;
    nativeClose();
    if (dialog.open) dialog.close();
    if (restoreFocus) options?.trigger?.focus();
    options = null;
    redraw();
  }

  function close() { finish(true); }

  function addPoints(event) {
    const events = event.getCoalescedEvents?.() || [];
    const samples = events.length ? [...events, event] : [event];
    for (const sample of samples) {
      active.points.push({ ...toLogicalPoint(sample, canvas.getBoundingClientRect(), { width: canvas.width, height: canvas.height, dpr }), width: pressureWidth(sample.pressure, active.pointerType) });
    }
    redraw();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!opened || busy) return;
    if (event.pointerType === "pen") {
      penSeen = true;
      if (active?.pointerType === "touch") {
        strokes = strokes.filter((stroke) => stroke !== active);
        active = null;
      }
    }
    if (!acceptsPointer(event.pointerType, penSeen) || active || event.button > 0) return;
    event.preventDefault();
    active = { pointerId: event.pointerId, pointerType: event.pointerType, points: [] };
    strokes.push(active);
    canvas.setPointerCapture(event.pointerId);
    addPoints(event);
    refresh();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (active?.pointerId !== event.pointerId || busy) return;
    event.preventDefault();
    addPoints(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    if (active?.pointerId !== event.pointerId) return;
    addPoints(event);
    active = null;
    refresh();
  });
  function cancelStroke(event) {
    if (active?.pointerId !== event.pointerId) return;
    strokes = strokes.filter((stroke) => stroke !== active);
    active = null;
    redraw();
    refresh();
  }
  canvas.addEventListener("pointercancel", cancelStroke);
  canvas.addEventListener("lostpointercapture", cancelStroke);
  buttons.undo.addEventListener("click", () => { if (!busy) { strokes.pop(); active = null; redraw(); refresh(); } });
  buttons.clear.addEventListener("click", () => { if (!busy) { strokes = []; active = null; redraw(); refresh(); } });
  buttons.cancel.addEventListener("click", close);
  buttons.insert.addEventListener("click", async () => {
    if (!opened || busy || active || strokes.length === 0) return;
    busy = true;
    const token = session;
    const current = options;
    controller = new AbortController();
    const signal = controller.signal;
    status.textContent = text.reading;
    refresh();
    try {
      const image = await exportHandwriting(doc, strokes);
      if (signal.aborted || token !== session) return;
      const result = await recognize({ image, lang: current.lang, signal });
      if (signal.aborted || token !== session) return;
      if (typeof result !== "string" || !result.trim()) throw Object.assign(new Error("empty result"), { status: 422 });
      finish(false);
      current.onInsert(result);
    } catch (error) {
      if (signal.aborted || token !== session) return;
      const key = [400, 413, 415].includes(error.status) ? "format" : error.status === 422 ? "empty" : error.status === 503 ? "unavailable" : "failed";
      status.textContent = text[key];
    } finally {
      if (token === session) { busy = false; controller = null; refresh(); }
    }
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { if (opened && !dialog.open) close(); });
  win.addEventListener?.("resize", resize);
  const observer = win.ResizeObserver ? new win.ResizeObserver(resize) : null;
  observer?.observe(canvas);

  function open(request) {
    if (opened) close();
    options = { ...request, lang: HANDWRITING_TEXT[request.lang] ? request.lang : "ko" };
    text = HANDWRITING_TEXT[options.lang];
    opened = true;
    session += 1;
    logicalWidth = 1;
    logicalHeight = 1;
    title.textContent = text.title;
    canvas.setAttribute("aria-label", text.canvas);
    canvas.tabIndex = 0;
    for (const [action, button] of Object.entries(buttons)) button.textContent = text[action];
    status.textContent = text.ready;
    refresh();
    dialog.showModal();
    resize();
    canvas.focus();
    nativeOpen(session);
  }
  return { open, close };
}
