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
  summaryTitle: "졸업 요건 진단",
  credits: "학점",
  itemsTitle: "요건별 이수 현황",
  unmetTitle: "미충족 요건",
  evidenceTitle: "근거",
  recommendTitle: "BISKIT 추천",
  link: "바로 가기 ↗",
  ask: "아이오에게 졸업 요건 묻기",
  met: "충족",
  unmet: "미충족",
});

/** 아이오 탭에 넘기는 일반 질문. 계정 정보는 넣지 않는다. */
export const ASK_QUESTION = "졸업 요건은 어떻게 확인하나요?";

/**
 * 응답 키 후보. 서버 계약은 요건 배열 items[]와 각 항목의 details.current·details.required,
 * 객체형 biskit_recommendations.programs[]를 쓴다. 앞에 있는 키가 이긴다. 배열은 서버 순서를 지킨다.
 */
export const FIELDS = Object.freeze({
  items: ["items", "requirements"],
  details: ["details"],
  current: ["current", "earned", "completed"],
  required: ["required", "needed"],
  status: ["status", "status_label", "result"],
  met: ["met", "passed", "satisfied", "eligible"],
  itemKey: ["id", "key", "code", "type"],
  name: ["name", "title", "label", "requirement"],
  detail: ["message", "detail", "description", "reason"],
  evidence: ["evidence", "basis", "citations", "sources"],
  recommendations: ["biskit_recommendations", "biskit", "recommendations"],
  programs: ["programs", "items"],
  document: ["document", "title", "name", "source"],
  article: ["article", "clause"],
  snippet: ["snippet", "text", "quote"],
  url: ["url", "link", "href"],
  notice: ["notice", "disclaimer", "message"],
  summary: ["summary", "overall"],
});

// 상태 문자열을 충족 여부로 읽는다. 표시 글자는 서버 값을 쓰고, 영어 코드만 우리말로 바꾼다.
const MET_CODES = new Map([
  ["met", true], ["pass", true], ["passed", true], ["satisfied", true], ["complete", true], ["completed", true], ["ok", true],
  ["unmet", false], ["not_met", false], ["fail", false], ["failed", false], ["unsatisfied", false], ["incomplete", false], ["missing", false],
]);
const MET_WORDS = [[/미충족|부족|미이수|불충족|미달/, false], [/충족|통과|완료|이수/, true]];

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

function linkOf(raw) {
  const value = isObj(raw) ? pick(raw, FIELDS.url) : undefined;
  return { url: safeLink(value), rawUrl: str(value) };
}

function statusOf(...sources) {
  let label = "";
  let met = null;
  for (const raw of sources) {
    if (!isObj(raw)) continue;
    const value = pick(raw, FIELDS.status);
    if (!label) {
      if (isObj(value)) label = str(pick(value, ["label", "text", "name"]));
      else if (typeof value === "string") label = str(value);
    }
    if (met === null) {
      const flag = (isObj(value) ? pick(value, FIELDS.met) : undefined) ?? pick(raw, FIELDS.met) ?? value;
      if (typeof flag === "boolean") met = flag;
    }
  }
  if (met === null && label) {
    const code = label.toLowerCase();
    if (MET_CODES.has(code)) met = MET_CODES.get(code);
    else for (const [pattern, value] of MET_WORDS) if (pattern.test(label)) { met = value; break; }
  }
  if (MET_CODES.has(label.toLowerCase())) label = MET_CODES.get(label.toLowerCase()) ? TEXT.met : TEXT.unmet;
  if (!label && met !== null) label = met ? TEXT.met : TEXT.unmet;
  return { label, met };
}

function evidenceList(raw, owner = "") {
  const value = isObj(raw) ? pick(raw, FIELDS.evidence) : raw;
  const entries = Array.isArray(value) ? value : value == null ? [] : [value];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") return str(entry) ? [{ owner, document: str(entry), article: "", snippet: "", url: null, rawUrl: "" }] : [];
    if (!isObj(entry)) return [];
    const out = {
      owner,
      document: str(pick(entry, FIELDS.document)),
      article: str(pick(entry, FIELDS.article)),
      snippet: str(pick(entry, FIELDS.snippet)),
      ...linkOf(entry),
    };
    return out.document || out.article || out.snippet ? [out] : [];
  });
}

function isTotalItem(raw, name) {
  return /total/i.test(str(pick(raw, FIELDS.itemKey))) || /총\s*(이수)?\s*학점|졸업\s*학점/.test(name);
}

/**
 * 서버 진단 응답을 화면 모양으로 바꾼다. 요건 항목도 총학점도 없으면 형식 오류로 본다.
 * 총학점 항목이 없으면 그래프만 빼고, 졸업 학점 같은 기본값을 지어내 채우지 않는다.
 */
export function normalizeDiagnosis(data) {
  if (!isObj(data)) throw new TypeError("diagnosis must be an object");
  const summary = pick(data, FIELDS.summary);
  const rawItems = pick(data, FIELDS.items);

  let total = null;
  const items = [];
  const evidence = [];
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    if (!isObj(raw)) continue;
    const name = str(pick(raw, FIELDS.name));
    if (!name) continue;
    const details = isObj(pick(raw, FIELDS.details)) ? pick(raw, FIELDS.details) : raw;
    const item = {
      name,
      current: credit(pick(details, FIELDS.current)),
      required: credit(pick(details, FIELDS.required)),
      status: statusOf(raw, details),
      detail: str(pick(raw, FIELDS.detail)) || str(pick(details, FIELDS.detail)),
      ...linkOf(raw),
    };
    if (!total && item.current && isTotalItem(raw, name)) total = { earned: item.current, required: item.required };
    items.push(item);
    evidence.push(...evidenceList(raw, name));
    if (details !== raw) evidence.push(...evidenceList(details, name));
  }
  evidence.push(...evidenceList(data));

  if (!items.length && !total) throw new TypeError("diagnosis needs requirement items");

  const recRaw = pick(data, FIELDS.recommendations);
  const programs = Array.isArray(recRaw) ? recRaw : Array.isArray(pick(recRaw, FIELDS.programs)) ? pick(recRaw, FIELDS.programs) : [];
  const recommendations = programs.flatMap((raw) => {
    if (typeof raw === "string") return str(raw) ? [{ title: str(raw), detail: "", url: null, rawUrl: "" }] : [];
    if (!isObj(raw)) return [];
    const out = { title: str(pick(raw, FIELDS.name)), detail: str(pick(raw, FIELDS.detail)), ...linkOf(raw) };
    return out.title || out.detail ? [out] : [];
  });

  return {
    total,
    status: statusOf(data, summary),
    items,
    unmet: items.filter((item) => item.status.met === false),
    evidence,
    recommendations,
    recommendNote: isObj(recRaw) ? str(pick(recRaw, FIELDS.notice)) : "",
    notice: str(pick(data, ["notice", "disclaimer"])) || str(pick(summary, ["notice", "disclaimer"])),
  };
}

/** 그래프 비율(0~100). 분모가 없거나 0 이하면 0. 숫자 표시는 이 값과 따로 서버 값을 쓴다. */
export function ringPercent(earned, required) {
  const e = Number(earned);
  const r = Number(required);
  if (!Number.isFinite(e) || !Number.isFinite(r) || r <= 0) return 0;
  return Math.min(100, Math.max(0, (e / r) * 100));
}

const pct2 = (earned, required) => Number(ringPercent(earned, required).toFixed(2));

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

  function section(title, key, children, note) {
    const box = el(doc, "section", { className: "grad-section", attrs: { "data-grad-section": key } });
    box.append(el(doc, "h2", { className: "section-title", text: title }));
    if (note) box.append(el(doc, "p", { className: "grad-notice", text: note }));
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

  function creditText(current, required) {
    if (!current) return "";
    return required ? `${current.text} / ${required.text}${TEXT.credits}` : `${current.text}${TEXT.credits}`;
  }

  function ringNode(total) {
    const ring = el(doc, "div", { className: "grad-ring", attrs: { "data-grad-ring": "" } });
    const pct = pct2(total.earned.value, total.required?.value);
    const graph = svg(doc, "svg", { viewBox: "0 0 120 120", class: "grad-ring-svg", "aria-hidden": "true", focusable: "false" });
    graph.append(
      svg(doc, "circle", { cx: 60, cy: 60, r: 52, pathLength: 100, class: "grad-ring-track" }),
      svg(doc, "circle", { cx: 60, cy: 60, r: 52, pathLength: 100, class: "grad-ring-value", "stroke-dasharray": `${pct} 100`, "data-percent": pct }),
    );
    const label = el(doc, "p", { className: "grad-ring-label", attrs: { "data-grad-total": "" } });
    label.append(el(doc, "strong", { className: "grad-ring-earned", text: total.earned.text }));
    label.append(el(doc, "span", { className: "grad-ring-required", text: total.required ? ` / ${total.required.text}${TEXT.credits}` : TEXT.credits }));
    ring.append(graph, label);
    return ring;
  }

  function renderResult(d) {
    const nodes = [];

    // 요약: 총학점 원형 그래프(있을 때만)와 전체 상태
    const summary = el(doc, "section", { className: "card grad-summary", attrs: { "data-grad-section": "total" } });
    summary.append(el(doc, "h2", { className: "section-title", text: d.total ? TEXT.totalTitle : TEXT.summaryTitle }));
    if (d.total) summary.append(ringNode(d.total));
    const badge = stateBadge(d.status);
    if (badge) summary.append(badge);
    if (d.notice) summary.append(el(doc, "p", { className: "grad-notice", text: d.notice, attrs: { "data-grad-notice": "" } }));
    nodes.push(summary);

    if (d.items.length) {
      nodes.push(section(TEXT.itemsTitle, "items", d.items.map((item) => {
        const li = el(doc, "li", { className: "card grad-item grad-category", attrs: { "data-grad-item": "" } });
        const head = el(doc, "div", { className: "grad-item-head" });
        head.append(el(doc, "p", { className: "grad-item-title", text: item.name }));
        const credits = creditText(item.current, item.required);
        if (credits) head.append(el(doc, "p", { className: "grad-item-credits", text: credits }));
        li.append(head);
        const b = stateBadge(item.status);
        if (b) li.append(b);
        if (item.current && item.required) {
          const bar = el(doc, "div", { className: "grad-bar", attrs: { "aria-hidden": "true" } });
          // style 속성 대신 CSSOM으로 넣어 CSP(style-src 'self')에 걸리지 않게 한다.
          const fill = el(doc, "div", { className: "grad-bar-fill" });
          fill.style.width = `${pct2(item.current.value, item.required.value)}%`;
          bar.append(fill);
          li.append(bar);
        }
        return li;
      })));
    }

    if (d.unmet.length) {
      nodes.push(section(TEXT.unmetTitle, "unmet", d.unmet.map((item) => {
        const li = el(doc, "li", { className: "card grad-item grad-unmet", attrs: { "data-grad-unmet": "" } });
        li.append(el(doc, "p", { className: "grad-item-title", text: item.name }));
        const credits = creditText(item.current, item.required);
        if (credits) li.append(el(doc, "p", { className: "grad-item-credits", text: credits }));
        if (item.detail) li.append(el(doc, "p", { className: "grad-item-detail", text: item.detail }));
        const link = linkOrText(item.url, item.rawUrl);
        if (link) li.append(link);
        return li;
      })));
    }

    if (d.evidence.length) {
      nodes.push(section(TEXT.evidenceTitle, "evidence", d.evidence.map((e) => {
        const li = el(doc, "li", { className: "card grad-item grad-evidence", attrs: { "data-grad-evidence": "" } });
        if (e.owner) li.append(el(doc, "span", { className: "grad-tag", text: e.owner }));
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
      }), d.recommendNote));
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
