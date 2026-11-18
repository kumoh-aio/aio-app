import { requestJson, secureUrl } from "./api.mjs";
import { API_BASE } from "./config.mjs";

export const TEXT = Object.freeze({
  idle: "학년도와 학기를 골라 학사일정을 확인하세요.",
  loading: "학사일정을 불러오는 중이에요.",
  empty: "등록된 학사일정이 없어요.",
  failed: "학사일정을 불러오지 못했어요. 다시 시도해 주세요.",
  retry: "다시 시도",
});

// 날짜를 시간대로 변환하지 않고 ISO 달력 날짜의 형식과 일수를 확인한다.
function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

const text = (value) => typeof value === "string" ? value : "";

export function mountCalendar({
  root, doc = root?.ownerDocument, fetchImpl = globalThis.fetch,
  base = API_BASE, initialYear = 2027, initialTerm = 1,
} = {}) {
  if (!root || !doc?.createElement) throw new TypeError("일정 화면과 문서 객체가 필요합니다.");
  const year = Number(initialYear);
  const term = Number(initialTerm);
  if (!Number.isInteger(year) || year < 2 || year > 9998 || ![1, 2].includes(term)) {
    throw new TypeError("학년도와 학기가 올바르지 않습니다.");
  }

  function element(tag, className, content) {
    const node = doc.createElement(tag);
    node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }

  function selection(labelText, values, selected) {
    const label = element("label", "", labelText);
    const select = element("select", "");
    select.setAttribute("aria-label", labelText);
    for (const [value, title] of values) {
      const option = element("option", "", title);
      option.value = String(value);
      select.append(option);
    }
    select.value = String(selected);
    label.append(select);
    return { label, select };
  }

  const controls = element("div", "calendar-controls");
  const years = selection("학년도", [year - 1, year, year + 1].map((y) => [y, `${y}학년도`]), year);
  const terms = selection("학기", [[1, "1학기"], [2, "2학기"]], term);
  controls.append(years.label, terms.label);
  const status = element("p", "status", TEXT.idle);
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const retry = element("button", "button-secondary", TEXT.retry);
  retry.type = "button";
  retry.hidden = true;
  const list = element("div", "calendar-list");
  root.replaceChildren(controls, status, retry, list);

  let state = "idle";
  let requestNumber = 0;
  let pending = Promise.resolve();

  function showStatus(nextState, message) {
    state = nextState;
    status.textContent = message;
    status.className = nextState === "empty" ? "status empty-state" : "status";
    status.hidden = nextState === "ready";
    retry.hidden = nextState !== "error";
    list.setAttribute("aria-busy", String(nextState === "loading"));
  }

  function renderEvent(event) {
    const card = element("article", "card calendar-event");
    card.append(element("h3", "", text(event.audience)));
    const end = validDate(event.ends_on) ? event.ends_on : "";
    card.append(element("p", "", end ? `${event.starts_on} ~ ${end}` : event.starts_on));
    for (const source of Array.isArray(event.sources) ? event.sources : []) {
      const row = element("p", "");
      const title = text(source?.title);
      if (secureUrl(source?.url)) {
        const link = element("a", "", title || source.url);
        link.setAttribute("href", source.url);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        row.append(link);
      } else {
        row.append(element("span", "", title));
      }
      if (text(source?.checked_on)) row.append(element("span", "", ` · 확인일 ${source.checked_on}`));
      card.append(row);
    }
    return card;
  }

  async function load(number, selectedYear, selectedTerm) {
    try {
      const data = await requestJson(`${base.replace(/\/+$/, "")}/api/v1/academic-calendar/${selectedYear}/${selectedTerm}`, { fetchImpl });
      if (number !== requestNumber) return;
      if (!Array.isArray(data?.events)) throw new TypeError("학사일정 응답 형식 오류");
      const events = data.events.filter((event) => validDate(event?.starts_on))
        .sort((a, b) => a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0);
      list.replaceChildren(...events.map(renderEvent));
      showStatus(events.length ? "ready" : "empty", events.length ? "" : TEXT.empty);
    } catch (error) {
      if (number !== requestNumber) return;
      showStatus(error?.status === 404 ? "empty" : "error", error?.status === 404 ? TEXT.empty : TEXT.failed);
    }
  }

  function start() {
    const number = ++requestNumber;
    list.replaceChildren();
    showStatus("loading", TEXT.loading);
    pending = load(number, years.select.value, terms.select.value);
    return pending;
  }

  years.select.addEventListener("change", start);
  terms.select.addEventListener("change", start);
  retry.addEventListener("click", start);

  return {
    refresh() {
      if (state === "idle" || state === "error") return start();
      return pending;
    },
  };
}
