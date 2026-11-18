import { requestJson, secureUrl } from "./api.mjs";
import { API_BASE } from "./config.mjs";
import { validDate, eventEnd, classifyEvent, layoutMonth, moveDate } from "./calendar-grid.mjs";

export const TEXT = Object.freeze({
  idle: "학년도와 학기를 골라 학사일정을 확인하세요.",
  loading: "학사일정을 불러오는 중이에요.",
  empty: "등록된 학사일정이 없어요.",
  failed: "학사일정을 불러오지 못했어요. 다시 시도해 주세요.",
  retry: "다시 시도",
});

const text = (value) => typeof value === "string" ? value : "";

export function mountCalendar({
  root, doc = root?.ownerDocument, fetchImpl = globalThis.fetch,
  base = API_BASE, initialYear = 2027, initialTerm = 1,
  today = new Date().toLocaleDateString("sv-SE"),
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
    if (tag === "button") node.type = "button";
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
  const switcher = element("div", "calendar-viewswitch");
  const calendarButton = element("button", "button-secondary", "달력");
  const listButton = element("button", "button-secondary", "목록");
  switcher.append(calendarButton, listButton);
  const panel = element("div", "calendar-panel");
  const nav = element("div", "calendar-nav");
  const previous = element("button", "button-secondary", "이전 달");
  const next = element("button", "button-secondary", "다음 달");
  const monthTitle = element("p", "calendar-month-title");
  nav.append(previous, monthTitle, next);
  panel.append(nav);
  root.replaceChildren(controls, status, retry, switcher, panel, list);
  let events = [];
  let mode = "calendar";
  let selected = validDate(today) ? today : `${year}-01-01`;
  let month = selected.slice(0, 7);
  let grid;
  let dayList;

  previous.addEventListener("click", () => choose(moveDate(selected, "PageUp")));
  next.addEventListener("click", () => choose(moveDate(selected, "PageDown")));

  function choose(value, focus = false) {
    selected = value;
    month = value.slice(0, 7);
    renderCalendar(focus);
  }

  function renderCalendar(focus = false) {
    calendarButton.setAttribute("aria-pressed", String(mode === "calendar"));
    listButton.setAttribute("aria-pressed", String(mode === "list"));
    list.hidden = mode !== "list";
    panel.hidden = mode !== "calendar" || !events.length;
    grid?.remove();
    dayList?.remove();
    if (!events.length) return;
    monthTitle.textContent = `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`;
    grid = element("div", "calendar-month");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", `${month} 학사일정`);
    const weekdays = element("div", "calendar-week calendar-weekdays");
    weekdays.setAttribute("role", "row");
    for (const day of ["일", "월", "화", "수", "목", "금", "토"]) {
      const header = element("span", "calendar-weekday", day);
      header.setAttribute("role", "columnheader");
      weekdays.append(header);
    }
    grid.append(weekdays);
    let focusTarget;
    for (const week of layoutMonth(events, month)) {
      const row = element("div", "calendar-week");
      row.setAttribute("role", "row");
      for (const [column, day] of week.days.entries()) {
        const matches = events.filter((event) => event.starts_on <= day.date && eventEnd(event) >= day.date);
        const cell = element("div", "calendar-day" + (day.outside ? " is-outside" : "") +
          (day.weekend ? " is-weekend" : "") + (day.date === today ? " is-today" : "") + (day.date === selected ? " is-selected" : ""));
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("tabindex", day.date === selected ? "0" : "-1");
        cell.setAttribute("aria-selected", String(day.date === selected));
        cell.setAttribute("aria-label", `${day.date}, 일정 ${matches.length}개`);
        cell.append(element("span", "calendar-day-number", String(Number(day.date.slice(8)))));
        const dots = element("span", "calendar-dots");
        dots.setAttribute("aria-hidden", "true");
        for (const event of matches.slice(0, 3)) dots.append(element("span", `calendar-dot calendar-cat-${classifyEvent(event)}`));
        cell.append(dots);
        if (week.hidden[column]) cell.append(element("span", "calendar-more", `+${week.hidden[column]}개`));
        cell.addEventListener("click", () => choose(day.date, true));
        cell.addEventListener("keydown", (event) => {
          if (["Enter", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
            event.preventDefault();
            choose(moveDate(day.date, event.key), true);
          }
        });
        if (day.date === selected) focusTarget = cell;
        row.append(cell);
      }
      const bars = element("div", "calendar-bars");
      bars.setAttribute("aria-hidden", "true");
      for (const bar of week.bars) {
        const node = element("span", `calendar-bar calendar-cat-${bar.category}` +
          (bar.continuedBefore ? " is-continued-before" : "") + (bar.continuedAfter ? " is-continued-after" : ""), text(bar.event.audience));
        node.style.gridColumn = `${bar.startColumn + 1} / ${bar.endColumn + 2}`;
        node.style.gridRow = String(bar.row + 1);
        bars.append(node);
      }
      row.append(bars);
      grid.append(row);
    }
    dayList = element("div", "calendar-day-list");
    dayList.append(element("h4", "", `${selected} 일정`));
    const matches = events.filter((event) => event.starts_on <= selected && eventEnd(event) >= selected);
    dayList.append(...matches.map(renderEvent));
    if (!matches.length) dayList.append(element("p", "empty-state", TEXT.empty));
    panel.append(grid, dayList);
    if (focus) focusTarget?.focus();
  }
  calendarButton.addEventListener("click", () => { mode = "calendar"; renderCalendar(); });
  listButton.addEventListener("click", () => { mode = "list"; renderCalendar(); });
  renderCalendar();

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
    const card = element("article", `card calendar-event calendar-cat-${classifyEvent(event)}`);
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
      events = data.events.filter((event) => validDate(event?.starts_on))
        .sort((a, b) => a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0);
      list.replaceChildren(...events.map(renderEvent));
      if (events.length) {
        const last = events.reduce((end, event) => eventEnd(event) > end ? eventEnd(event) : end, events[0].starts_on);
        selected = validDate(today) && today >= events[0].starts_on && today <= last ? today : events[0].starts_on;
        month = selected.slice(0, 7);
      }
      renderCalendar();
      showStatus(events.length ? "ready" : "empty", events.length ? "" : TEXT.empty);
    } catch (error) {
      if (number !== requestNumber) return;
      showStatus(error?.status === 404 ? "empty" : "error", error?.status === 404 ? TEXT.empty : TEXT.failed);
    }
  }

  function start() {
    const number = ++requestNumber;
    list.replaceChildren();
    events = [];
    renderCalendar();
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
