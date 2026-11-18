// 졸업 요건 진단 화면. 문서 객체와 진단 조회 함수를 주입받고, 서버가 준 값만 그대로 그린다.
// 학생 ID는 조회 함수에만 넘기고 화면·저장소·아이오 질문에 남기지 않는다. 글자는 textContent로만 넣는다.
import { secureUrl } from "./api.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

export const TEXT = Object.freeze({
  idle: "시연 계정으로 로그인하면 졸업 요건 진단을 보여 드려요.",
  loading: "졸업 요건 진단을 불러오는 중이에요.",
  notFound: "이 계정의 졸업 요건 진단을 찾지 못했어요. 다른 시연 계정을 고르거나 다시 시도해 주세요.",
  failed: "졸업 요건 진단을 받지 못했어요. 연결을 확인하고 다시 시도해 주세요.",
  invalid: "졸업 요건 진단 형식이 올바르지 않아요. 잠시 뒤 다시 시도해 주세요.",
  retry: "다시 시도",
  totalTitle: "총 이수학점",
  credits: "학점",
  categoriesTitle: "영역별 이수 현황",
  unmetTitle: "미충족 요건",
  evidenceTitle: "근거",
  recommendTitle: "BISKIT 추천",
  link: "바로 가기 ↗",
  ask: "아이오에게 졸업 요건 묻기",
});

/** 아이오 탭에 넘기는 일반 질문. 계정 정보는 넣지 않는다. */
export const ASK_QUESTION = "졸업 요건은 어떻게 확인하나요?";

/**
 * 응답 키 후보. 서버 API_SPEC.md를 확인하면 여기만 고친다. 앞에 있는 키가 이긴다.
 * 배열 항목은 서버 순서를 그대로 지킨다.
 */
export const FIELDS = Object.freeze({
  total: ["total", "total_credits", "credits"],
  earned: ["earned", "completed", "acquired"],
  required: ["required", "needed"],
  status: ["status", "status_label", "result"],
  met: ["met", "eligible", "passed"],
  categories: ["categories", "areas", "progress"],
  unmet: ["unmet", "unmet_requirements", "missing"],
  evidence: ["evidence", "basis", "citations", "sources"],
  recommendations: ["biskit", "biskit_recommendations", "recommendations"],
  name: ["name", "title", "label", "area", "requirement"],
  detail: ["detail", "description", "message", "reason"],
  category: ["category", "area_name", "group"],
  document: ["document", "title", "name"],
  article: ["article", "clause"],
  snippet: ["snippet", "text", "quote"],
  url: ["url", "link", "href"],
  notice: ["notice", "disclaimer"],
});

const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const pick = (obj, keys) => {
  if (!isObj(obj)) return undefined;
  for (const key of keys) if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  return undefined;
};
const str = (value) => (typeof value === "string" ? value.trim() : "");

// 학점은 서버 값 그대로 보여 준다. 숫자이거나 숫자 문자열일 때만 받는다.
function credit(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { text: String(value), value };
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return { text: value.trim(), value: Number(value) };
  }
  return null;
}

/** https 주소만 정규화해 돌려준다. 그 밖에는 null. */
export function safeLink(value) {
  if (!secureUrl(value)) return null;
  return new URL(value).href;
}

function statusOf(raw, source) {
  const value = pick(raw, FIELDS.status);
  const metRaw = (isObj(value) ? pick(value, FIELDS.met) : undefined) ?? pick(raw, FIELDS.met) ?? pick(source, FIELDS.met);
  const label = isObj(value) ? str(pick(value, ["label", "text", "name"])) : str(value);
  return { label, met: typeof metRaw === "boolean" ? metRaw : null };
}

function list(raw, keys) {
  const value = pick(raw, keys);
  return Array.isArray(value) ? value : [];
}

function item(raw, map) {
  if (typeof raw === "string") return str(raw) ? { [map.primary]: str(raw) } : null;
  if (!isObj(raw)) return null;
  const out = {};
  for (const [name, keys] of Object.entries(map.fields)) out[name] = str(pick(raw, keys));
  return out;
}

/**
 * 서버 진단 응답을 화면 모양으로 바꾼다. 총학점이 없으면 형식 오류로 본다.
 * 졸업 학점 같은 기본값을 지어내 채우지 않는다.
 */
export function normalizeDiagnosis(data) {
  if (!isObj(data)) throw new TypeError("diagnosis must be an object");
  const totalRaw = pick(data, FIELDS.total);
  const earned = credit(isObj(totalRaw) ? pick(totalRaw, FIELDS.earned) : pick(data, ["earned_credits"]));
  const required = credit(isObj(totalRaw) ? pick(totalRaw, FIELDS.required) : pick(data, ["required_credits"]));
  if (!earned) throw new TypeError("diagnosis needs total earned credits");

  const categories = list(data, FIELDS.categories).flatMap((raw) => {
    if (!isObj(raw)) return [];
    const name = str(pick(raw, FIELDS.name));
    if (!name) return [];
    return [{
      name,
      earned: credit(pick(raw, FIELDS.earned)),
      required: credit(pick(raw, FIELDS.required)),
      status: statusOf(raw),
    }];
  });

  const unmet = list(data, FIELDS.unmet).flatMap((raw) => {
    const out = item(raw, { primary: "title", fields: { title: FIELDS.name, detail: FIELDS.detail, category: FIELDS.category } });
    if (!out || !(out.title || out.detail)) return [];
    return [{ title: out.title ?? "", detail: out.detail ?? "", category: out.category ?? "", url: safeLink(isObj(raw) ? pick(raw, FIELDS.url) : null), rawUrl: isObj(raw) ? str(pick(raw, FIELDS.url)) : "" }];
  });

  const evidence = list(data, FIELDS.evidence).flatMap((raw) => {
    const out = item(raw, { primary: "document", fields: { document: FIELDS.document, article: FIELDS.article, snippet: FIELDS.snippet } });
    if (!out || !(out.document || out.article || out.snippet)) return [];
    return [{ document: out.document ?? "", article: out.article ?? "", snippet: out.snippet ?? "", url: safeLink(isObj(raw) ? pick(raw, FIELDS.url) : null), rawUrl: isObj(raw) ? str(pick(raw, FIELDS.url)) : "" }];
  });

  const recommendations = list(data, FIELDS.recommendations).flatMap((raw) => {
    const out = item(raw, { primary: "title", fields: { title: FIELDS.name, detail: FIELDS.detail } });
    if (!out || !(out.title || out.detail)) return [];
    return [{ title: out.title ?? "", detail: out.detail ?? "", url: safeLink(isObj(raw) ? pick(raw, FIELDS.url) : null), rawUrl: isObj(raw) ? str(pick(raw, FIELDS.url)) : "" }];
  });

  return {
    total: { earned, required },
    status: statusOf(data, totalRaw),
    categories,
    unmet,
    evidence,
    recommendations,
    notice: str(pick(data, FIELDS.notice)),
  };
}

/** 그래프 비율(0~100). 분모가 없거나 0 이하면 0. 숫자 표시는 이 값과 따로 서버 값을 쓴다. */
export function ringPercent(earned, required) {
  const e = Number(earned);
  const r = Number(required);
  if (!Number.isFinite(e) || !Number.isFinite(r) || r <= 0) return 0;
  return Math.min(100, Math.max(0, (e / r) * 100));
}

function el(doc, tag, { className, text, attrs } = {}) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

function svg(doc, tag, attrs) {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

function errorKind(error) {
  if (error?.status === 404) return "notFound";
  if (error?.code === "invalid") return "invalid";
  return "failed";
}

/**
 * 졸업 진단 화면을 root 안에 그린다.
 * @param {{ root: any, doc: any,
 *           loadDiagnosis: (studentId: string, options: { signal: AbortSignal }) => Promise<object>,
 *           onAsk?: (pending: { question: string }) => void }} options
 * @returns {{ show(studentId: string): Promise<string>, clear(): void, readonly state: string }}
 */
export function mountGraduationDiagnosis({ root, doc, loadDiagnosis, onAsk }) {
  if (!root || !doc || typeof loadDiagnosis !== "function") {
    throw new TypeError("mountGraduationDiagnosis needs root, doc and loadDiagnosis");
  }
  let token = 0;
  let controller = null;
  let currentId = null; // 재시도에만 쓰고 화면에는 그리지 않는다
  let state = "idle";

  const status = el(doc, "p", { className: "status grad-status", attrs: { "aria-live": "polite", "data-grad-status": "" } });
  const retry = el(doc, "button", { className: "button-secondary grad-retry", text: TEXT.retry, attrs: { type: "button", "data-grad-retry": "" } });
  retry.addEventListener("click", () => {
    if (currentId != null && state === "error") show(currentId);
  });
  const result = el(doc, "div", { className: "grad-result", attrs: { "data-grad-result": "" } });

  function paint(next, message, kind) {
    state = next;
    root.setAttribute?.("aria-busy", next === "loading" ? "true" : "false");
    root.setAttribute?.("data-state", next);
    status.textContent = message ?? "";
    status.hidden = !message;
    status.setAttribute("data-state", kind ?? next);
    retry.hidden = next !== "error";
    if (next !== "ready") result.replaceChildren();
    result.hidden = next !== "ready";
  }

  function section(title, key, children) {
    const box = el(doc, "section", { className: "grad-section", attrs: { "data-grad-section": key } });
    box.append(el(doc, "h2", { className: "section-title", text: title }));
    const ul = el(doc, "ul", { className: "grad-list" });
    ul.append(...children);
    box.append(ul);
    return box;
  }

  function linkOrText(url, rawUrl) {
    if (url) {
      return el(doc, "a", { className: "grad-link", text: TEXT.link, attrs: { href: url, target: "_blank", rel: "noopener noreferrer", "data-grad-link": "" } });
    }
    return rawUrl ? el(doc, "p", { className: "grad-url-text", text: rawUrl, attrs: { "data-grad-url-text": "" } }) : null;
  }

  function stateBadge(s) {
    if (!s.label) return null;
    const metText = s.met === true ? "met" : s.met === false ? "unmet" : "unknown";
    return el(doc, "span", { className: "grad-badge", text: s.label, attrs: { "data-met": metText, "data-grad-badge": "" } });
  }

  function creditText(earned, required) {
    if (!earned) return "";
    return required ? `${earned.text} / ${required.text}${TEXT.credits}` : `${earned.text}${TEXT.credits}`;
  }

  function renderResult(d) {
    const nodes = [];

    // 총학점 원형 그래프
    const summary = el(doc, "section", { className: "card grad-summary", attrs: { "data-grad-section": "total" } });
    summary.append(el(doc, "h2", { className: "section-title", text: TEXT.totalTitle }));
    const ring = el(doc, "div", { className: "grad-ring", attrs: { "data-grad-ring": "" } });
    const pct = ringPercent(d.total.earned.value, d.total.required?.value);
    const graph = svg(doc, "svg", { viewBox: "0 0 120 120", class: "grad-ring-svg", "aria-hidden": "true", focusable: "false" });
    graph.append(
      svg(doc, "circle", { cx: 60, cy: 60, r: 52, pathLength: 100, class: "grad-ring-track" }),
      svg(doc, "circle", { cx: 60, cy: 60, r: 52, pathLength: 100, class: "grad-ring-value",
        "stroke-dasharray": `${Number(pct.toFixed(2))} 100`, "data-percent": Number(pct.toFixed(2)) }),
    );
    const label = el(doc, "p", { className: "grad-ring-label", attrs: { "data-grad-total": "" } });
    label.append(el(doc, "strong", { className: "grad-ring-earned", text: d.total.earned.text }));
    if (d.total.required) label.append(el(doc, "span", { className: "grad-ring-required", text: ` / ${d.total.required.text}${TEXT.credits}` }));
    else label.append(el(doc, "span", { className: "grad-ring-required", text: TEXT.credits }));
    ring.append(graph, label);
    summary.append(ring);
    const badge = stateBadge(d.status);
    if (badge) summary.append(badge);
    if (d.notice) summary.append(el(doc, "p", { className: "grad-notice", text: d.notice, attrs: { "data-grad-notice": "" } }));
    nodes.push(summary);

    if (d.categories.length) {
      nodes.push(section(TEXT.categoriesTitle, "categories", d.categories.map((c) => {
        const li = el(doc, "li", { className: "card grad-item grad-category", attrs: { "data-grad-category": "" } });
        const head = el(doc, "div", { className: "grad-item-head" });
        head.append(el(doc, "p", { className: "grad-item-title", text: c.name }));
        const credits = creditText(c.earned, c.required);
        if (credits) head.append(el(doc, "p", { className: "grad-item-credits", text: credits }));
        li.append(head);
        const b = stateBadge(c.status);
        if (b) li.append(b);
        if (c.earned && c.required) {
          const bar = el(doc, "div", { className: "grad-bar", attrs: { "aria-hidden": "true" } });
          // style 속성 대신 CSSOM으로 넣어 CSP(style-src 'self')에 걸리지 않게 한다.
          const fill = el(doc, "div", { className: "grad-bar-fill" });
          fill.style.width = `${Number(ringPercent(c.earned.value, c.required.value).toFixed(2))}%`;
          bar.append(fill);
          li.append(bar);
        }
        return li;
      })));
    }

    if (d.unmet.length) {
      nodes.push(section(TEXT.unmetTitle, "unmet", d.unmet.map((u) => {
        const li = el(doc, "li", { className: "card grad-item grad-unmet", attrs: { "data-grad-unmet": "" } });
        if (u.category) li.append(el(doc, "span", { className: "grad-tag", text: u.category }));
        if (u.title) li.append(el(doc, "p", { className: "grad-item-title", text: u.title }));
        if (u.detail) li.append(el(doc, "p", { className: "grad-item-detail", text: u.detail }));
        const link = linkOrText(u.url, u.rawUrl);
        if (link) li.append(link);
        return li;
      })));
    }

    if (d.evidence.length) {
      nodes.push(section(TEXT.evidenceTitle, "evidence", d.evidence.map((e) => {
        const li = el(doc, "li", { className: "card grad-item grad-evidence", attrs: { "data-grad-evidence": "" } });
        const meta = [e.document, e.article].filter(Boolean);
        if (meta.length) li.append(el(doc, "p", { className: "citation-meta", text: meta.join(" · ") }));
        if (e.snippet) li.append(el(doc, "blockquote", { className: "citation-snippet", text: e.snippet }));
        const link = linkOrText(e.url, e.rawUrl);
        if (link) li.append(link);
        return li;
      })));
    }

    if (d.recommendations.length) {
      nodes.push(section(TEXT.recommendTitle, "recommendations", d.recommendations.map((r) => {
        const li = el(doc, "li", { className: "card grad-item grad-recommend", attrs: { "data-grad-recommend": "" } });
        if (r.title) li.append(el(doc, "p", { className: "grad-item-title", text: r.title }));
        if (r.detail) li.append(el(doc, "p", { className: "grad-item-detail", text: r.detail }));
        const link = linkOrText(r.url, r.rawUrl);
        if (link) li.append(link);
        return li;
      })));
    }

    if (typeof onAsk === "function") {
      const ask = el(doc, "button", { className: "button-primary grad-ask", text: TEXT.ask, attrs: { type: "button", "data-grad-ask": "" } });
      ask.addEventListener("click", () => onAsk({ question: ASK_QUESTION }));
      nodes.push(ask);
    }

    result.replaceChildren(...nodes);
  }

  function cancel() {
    token += 1;
    controller?.abort();
    controller = null;
  }

  async function show(studentId) {
    const id = typeof studentId === "number" && Number.isFinite(studentId) ? String(studentId) : str(studentId);
    if (!id) throw new TypeError("show needs a student id");
    cancel();
    const mine = token;
    const ctrl = new AbortController();
    controller = ctrl;
    currentId = id;
    paint("loading", TEXT.loading); // 이전 계정 결과는 여기서 바로 지운다

    let diagnosis;
    try {
      const data = await loadDiagnosis(id, { signal: ctrl.signal });
      if (mine !== token) return "stale";
      try {
        diagnosis = normalizeDiagnosis(data);
      } catch {
        throw Object.assign(new Error("invalid diagnosis"), { code: "invalid" });
      }
    } catch (error) {
      if (mine !== token) return "stale";
      controller = null;
      const kind = errorKind(error);
      paint("error", TEXT[kind], kind);
      return kind;
    }
    controller = null;
    renderResult(diagnosis);
    paint("ready", "", "ready");
    return "ready";
  }

  function clear() {
    cancel();
    currentId = null;
    paint("idle", TEXT.idle);
  }

  root.replaceChildren(status, retry, result);
  paint("idle", TEXT.idle);

  return {
    show,
    clear,
    get state() {
      return state;
    },
  };
}
