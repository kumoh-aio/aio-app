// 졸업 요건 진단 화면. 문서 객체와 진단 조회 함수를 주입받고, 서버가 준 값만 그대로 그린다.
// 학생 ID는 조회 함수에만 넘기고 화면·저장소·아이오 질문에 남기지 않는다. 글자는 textContent로만 넣는다.
//
// 응답 계약: 서버 저장소 api/docs/API_SPEC.md "GET /graduation-demo"
// (namelesspark/kumoh-academic-rag@37b75185cfc393a87110acee3e8a0d96e2d5ef71)
// - items[]: total_credits·major_required·extracurricular 상위 행. 상위 행만 details[] 세부 행을 가진다.
// - 행: id, label, status(met·short·needs_check), current, required, shortfall, reason, basis
// - basis: applied_rule(항상), source_title, source_url, checked_on(확인한 값만)
// - biskit_recommendations: null 또는 { shortfall_points, listed_on, evaluated_at, portal_url, programs[] }
// - programs[]: title, audience, eligibility, apply_until, deadline_status, event_on,
//   mileage_status, mileage_points, notice_url, application_url, login_required
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
  unmetTitle: "부족·확인 필요 요건",
  evidenceTitle: "근거",
  recommendTitle: "BISKIT 비교과 추천",
  noPrograms: "지금 신청할 수 있는 추천 프로그램이 없어요.",
  shortfall: "부족",
  shortfallPoints: "부족 마일리지",
  listedOn: "목록 확인일",
  checkedOn: "확인일",
  applyUntil: "신청 마감",
  eventOn: "행사일",
  audience: "대상",
  eligibilityCheck: "재학 상태 확인 필요",
  deadlineCheck: "마감 시각 확인 필요",
  loginRequired: "BISKIT 로그인 필요",
  mileagePoints: "마일리지",
  mileageAnnounced: "마일리지 지급 공지",
  mileageUndisclosed: "마일리지 미공개",
  portal: "BISKIT 열기 ↗",
  notice: "공지 보기 ↗",
  apply: "신청하기 ↗",
  source: "원문 보기 ↗",
  ask: "아이오에게 졸업 요건 묻기",
});

export const STATUS_LABELS = Object.freeze({ met: "충족", short: "부족", needs_check: "확인 필요" });

/** 아이오 탭에 넘기는 일반 질문. 계정 정보는 넣지 않는다. */
export const ASK_QUESTION = "졸업 요건은 어떻게 확인하나요?";

const TOTAL_ITEM = "total_credits";
const TOTAL_DETAIL = "credits_total";

const isObj = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const str = (value) => (typeof value === "string" ? value.trim() : "");

// 수치는 서버 값 그대로 보여 준다. 숫자이거나 숫자 문자열일 때만 받고, null은 표시하지 않는다.
function num(value) {
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

const link = (value) => ({ url: safeLink(value), rawUrl: str(value) });

function basisOf(raw) {
  if (!isObj(raw)) return null;
  const basis = {
    appliedRule: str(raw.applied_rule),
    sourceTitle: str(raw.source_title),
    checkedOn: str(raw.checked_on),
    ...link(raw.source_url),
  };
  return basis.appliedRule || basis.sourceTitle || basis.rawUrl ? basis : null;
}

function rowOf(raw) {
  if (!isObj(raw)) return null;
  const id = str(raw.id);
  const label = str(raw.label) || id;
  if (!label) return null;
  const status = str(raw.status);
  return {
    id,
    label,
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    current: num(raw.current),
    required: num(raw.required),
    shortfall: num(raw.shortfall) ?? (str(raw.shortfall) ? { text: str(raw.shortfall), value: NaN } : null),
    reason: str(raw.reason),
    basis: basisOf(raw.basis),
  };
}

function programOf(raw) {
  if (!isObj(raw)) return null;
  const title = str(raw.title);
  if (!title) return null;
  return {
    title,
    audience: str(raw.audience),
    eligibility: str(raw.eligibility),
    applyUntil: str(raw.apply_until),
    deadlineStatus: str(raw.deadline_status),
    eventOn: str(raw.event_on),
    mileageStatus: str(raw.mileage_status),
    mileagePoints: num(raw.mileage_points),
    loginRequired: raw.login_required === true,
    notice: link(raw.notice_url),
    application: link(raw.application_url),
  };
}

/**
 * 서버 진단 응답을 화면 모양으로 바꾼다. 행이 하나도 없으면 형식 오류다.
 * 졸업 학점 같은 기본값을 지어내 채우지 않는다.
 */
export function normalizeDiagnosis(data) {
  if (!isObj(data) || !Array.isArray(data.items)) throw new TypeError("diagnosis needs items[]");
  const items = data.items.flatMap((raw) => {
    const row = rowOf(raw);
    if (!row) return [];
    row.details = Array.isArray(raw.details) ? raw.details.map(rowOf).filter(Boolean) : [];
    return [row];
  });
  if (!items.length) throw new TypeError("diagnosis needs at least one requirement row");

  // 총학점: total_credits 행의 credits_total 세부 행. 없으면 그래프를 그리지 않는다.
  const totalItem = items.find((row) => row.id === TOTAL_ITEM);
  const totalRow = totalItem?.details.find((row) => row.id === TOTAL_DETAIL);
  const total = totalRow?.current ? { row: totalRow, item: totalItem } : null;

  // 부족·확인 필요: 세부 행이 있으면 세부 행, 없으면 상위 행. 서버 순서를 지킨다.
  const unmet = items.flatMap((row) => {
    const rows = row.details.length ? row.details : [row];
    return rows.filter((r) => r.status === "short" || r.status === "needs_check").map((r) => ({ ...r, owner: row.label, ownerId: row.id }));
  });

  // 근거: 상위 행 → 세부 행 순서. 같은 근거는 한 번만 보이고 해당 행 이름을 모은다.
  const evidence = [];
  const seen = new Map();
  for (const row of items) {
    for (const r of [row, ...row.details]) {
      if (!r.basis) continue;
      const key = JSON.stringify([r.basis.appliedRule, r.basis.sourceTitle, r.basis.rawUrl, r.basis.checkedOn]);
      if (seen.has(key)) {
        seen.get(key).owners.push(r.label);
        continue;
      }
      const entry = { ...r.basis, owners: [r.label] };
      seen.set(key, entry);
      evidence.push(entry);
    }
  }

  const rec = data.biskit_recommendations;
  const recommendations = isObj(rec)
    ? {
      shortfallPoints: num(rec.shortfall_points),
      listedOn: str(rec.listed_on),
      portal: link(rec.portal_url),
      programs: Array.isArray(rec.programs) ? rec.programs.map(programOf).filter(Boolean) : [],
    }
    : null;

  return { profileLabel: isObj(data.profile) ? str(data.profile.label) : "", total, items, unmet, evidence, recommendations };
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

  const section = (title, key) => {
    const box = el(doc, "section", { className: "grad-section", attrs: { "data-grad-section": key } });
    box.append(el(doc, "h2", { className: "section-title", text: title }));
    return box;
  };
  const list = (children) => {
    const ul = el(doc, "ul", { className: "grad-list" });
    ul.append(...children);
    return ul;
  };
  const line = (className, text, attrs) => el(doc, "p", { className, text, attrs });

  // https면 a, 아니면 주소를 글자로만 둔다. 값이 없으면 아무것도 없다.
  function linkOrText({ url, rawUrl }, label, kind) {
    if (url) {
      return el(doc, "a", { className: "grad-link", text: label, attrs: { href: url, target: "_blank", rel: "noopener noreferrer", "data-grad-link": kind } });
    }
    return rawUrl ? line("grad-url-text", rawUrl, { "data-grad-url-text": kind }) : null;
  }

  function badge(row) {
    if (!row.statusLabel) return null;
    return el(doc, "span", { className: "grad-badge", text: row.statusLabel, attrs: { "data-status": row.status || "unknown", "data-grad-badge": "" } });
  }

  function amount(row, unit) {
    if (!row.current && !row.required) return "";
    const u = unit ?? "";
    if (row.current && row.required) return `${row.current.text} / ${row.required.text}${u}`;
    return `${(row.current ?? row.required).text}${u}`;
  }

  function note(row) {
    if (row.status === "short" && row.shortfall) return `${TEXT.shortfall} ${row.shortfall.text}`;
    if (row.reason) return row.reason;
    return "";
  }

  function rowNode(row, unit, attr, { className = "grad-row", tag = "" } = {}) {
    const li = el(doc, "li", { className, attrs: { [attr]: "", "data-status": row.status || "unknown" } });
    if (tag) li.append(el(doc, "span", { className: "grad-tag", text: tag }));
    const head = el(doc, "div", { className: "grad-item-head" });
    head.append(line("grad-item-title", row.label));
    const b = badge(row);
    if (b) head.append(b);
    li.append(head);
    const credits = amount(row, unit);
    if (credits) li.append(line("grad-item-credits", credits));
    const n = note(row);
    if (n) li.append(line("grad-item-detail", n));
    if (row.current && row.required) {
      const bar = el(doc, "div", { className: "grad-bar", attrs: { "aria-hidden": "true" } });
      // style 속성 대신 CSSOM으로 넣어 CSP(style-src 'self')에 걸리지 않게 한다.
      const fill = el(doc, "div", { className: "grad-bar-fill" });
      fill.style.width = `${pct2(row.current.value, row.required.value)}%`;
      bar.append(fill);
      li.append(bar);
    }
    return li;
  }

  function ringNode(row) {
    const ring = el(doc, "div", { className: "grad-ring", attrs: { "data-grad-ring": "" } });
    const pct = pct2(row.current.value, row.required?.value);
    const graph = svg(doc, "svg", { viewBox: "0 0 120 120", class: "grad-ring-svg", "aria-hidden": "true", focusable: "false" });
    graph.append(
      svg(doc, "circle", { cx: 60, cy: 60, r: 52, pathLength: 100, class: "grad-ring-track" }),
      svg(doc, "circle", { cx: 60, cy: 60, r: 52, pathLength: 100, class: "grad-ring-value", "stroke-dasharray": `${pct} 100`, "data-percent": pct }),
    );
    const label = line("grad-ring-label", null, { "data-grad-total": "" });
    label.append(el(doc, "strong", { className: "grad-ring-earned", text: row.current.text }));
    label.append(el(doc, "span", { className: "grad-ring-required", text: row.required ? ` / ${row.required.text}${TEXT.credits}` : TEXT.credits }));
    ring.append(graph, label);
    return ring;
  }

  function renderResult(d) {
    const nodes = [];

    // 요약: 총학점 원형 그래프와 총학점 상태
    const summary = el(doc, "section", { className: "card grad-summary", attrs: { "data-grad-section": "total" } });
    summary.append(el(doc, "h2", { className: "section-title", text: d.total ? TEXT.totalTitle : TEXT.summaryTitle }));
    if (d.profileLabel) summary.append(line("grad-profile", d.profileLabel, { "data-grad-profile": "" }));
    if (d.total) {
      summary.append(ringNode(d.total.row));
      const b = badge(d.total.row);
      if (b) summary.append(b);
      const n = note(d.total.row);
      if (n) summary.append(line("grad-notice", n));
    }
    nodes.push(summary);

    // 요건별 현황: 상위 행 카드 안에 세부 행을 서버 순서대로
    const items = section(TEXT.itemsTitle, "items");
    items.append(list(d.items.map((item) => {
      const li = el(doc, "li", { className: "card grad-item", attrs: { "data-grad-item": item.id, "data-status": item.status || "unknown" } });
      const head = el(doc, "div", { className: "grad-item-head" });
      head.append(line("grad-item-title", item.label));
      const b = badge(item);
      if (b) head.append(b);
      li.append(head);
      const n = note(item);
      if (n) li.append(line("grad-item-detail", n));
      if (!item.details.length) {
        const credits = amount(item);
        if (credits) li.append(line("grad-item-credits", credits));
      } else {
        const unit = item.id === TOTAL_ITEM ? TEXT.credits : "";
        const ul = el(doc, "ul", { className: "grad-rows" });
        ul.append(...item.details.map((row) => rowNode(row, unit, "data-grad-detail")));
        li.append(ul);
      }
      return li;
    })));
    nodes.push(items);

    if (d.unmet.length) {
      const box = section(TEXT.unmetTitle, "unmet");
      box.append(list(d.unmet.map((row) => rowNode(row, row.ownerId === TOTAL_ITEM ? TEXT.credits : "", "data-grad-unmet", {
        className: "card grad-item grad-unmet",
        tag: row.owner === row.label ? "" : row.owner,
      }))));
      nodes.push(box);
    }

    if (d.evidence.length) {
      const box = section(TEXT.evidenceTitle, "evidence");
      box.append(list(d.evidence.map((e) => {
        const li = el(doc, "li", { className: "card grad-item grad-evidence", attrs: { "data-grad-evidence": "" } });
        li.append(el(doc, "span", { className: "grad-tag", text: e.owners.join(" · ") }));
        if (e.appliedRule) li.append(el(doc, "blockquote", { className: "citation-snippet", text: e.appliedRule }));
        const meta = [e.sourceTitle, e.checkedOn ? `${TEXT.checkedOn} ${e.checkedOn}` : ""].filter(Boolean);
        if (meta.length) li.append(line("citation-meta", meta.join(" · ")));
        const a = linkOrText(e, TEXT.source, "source");
        if (a) li.append(a);
        return li;
      })));
      nodes.push(box);
    }

    // BISKIT 추천: 서버가 null이면(마일리지 충족·부족량 모름) 구역을 그리지 않는다.
    if (d.recommendations) {
      const r = d.recommendations;
      const box = section(TEXT.recommendTitle, "recommendations");
      const meta = [
        r.shortfallPoints ? `${TEXT.shortfallPoints} ${r.shortfallPoints.text}점` : "",
        r.listedOn ? `${TEXT.listedOn} ${r.listedOn}` : "",
      ].filter(Boolean);
      if (meta.length) box.append(line("grad-notice", meta.join(" · "), { "data-grad-rec-meta": "" }));
      const portal = linkOrText(r.portal, TEXT.portal, "portal");
      if (portal) box.append(portal);
      if (!r.programs.length) {
        box.append(line("grad-notice", TEXT.noPrograms, { "data-grad-no-programs": "" }));
      } else {
        box.append(list(r.programs.map((p) => {
          const li = el(doc, "li", { className: "card grad-item grad-recommend", attrs: { "data-grad-recommend": "" } });
          li.append(line("grad-item-title", p.title));
          if (p.audience) li.append(line("grad-item-detail", `${TEXT.audience} ${p.audience}`));
          const facts = [
            p.applyUntil ? `${TEXT.applyUntil} ${p.applyUntil}` : "",
            p.deadlineStatus === "needs_check" ? TEXT.deadlineCheck : "",
            p.eventOn ? `${TEXT.eventOn} ${p.eventOn}` : "",
            p.mileageStatus === "published" && p.mileagePoints ? `${TEXT.mileagePoints} ${p.mileagePoints.text}점`
              : p.mileageStatus === "announced" ? TEXT.mileageAnnounced
                : p.mileageStatus === "undisclosed" ? TEXT.mileageUndisclosed : "",
            p.eligibility === "needs_check" ? TEXT.eligibilityCheck : "",
            p.loginRequired ? TEXT.loginRequired : "",
          ].filter(Boolean);
          if (facts.length) li.append(line("grad-item-detail", facts.join(" · "), { "data-grad-facts": "" }));
          for (const a of [linkOrText(p.notice, TEXT.notice, "notice"), linkOrText(p.application, TEXT.apply, "apply")]) {
            if (a) li.append(a);
          }
          return li;
        })));
      }
      nodes.push(box);
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
    const id = str(studentId);
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
