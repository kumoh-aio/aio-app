export function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function daysInMonth(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function dateObject(value) {
  if (!validDate(value)) throw new TypeError("올바른 ISO 날짜가 필요합니다.");
  return new Date(`${value}T00:00:00Z`);
}

function iso(date) {
  const value = date.toISOString().slice(0, 10);
  if (!validDate(value)) throw new RangeError("지원하는 날짜 범위를 벗어났습니다.");
  return value;
}

export function addDays(value, days) {
  const date = dateObject(value);
  date.setUTCDate(date.getUTCDate() + days);
  return iso(date);
}

export function moveDate(value, key) {
  const date = dateObject(value);
  const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    Home: -date.getUTCDay(), End: 6 - date.getUTCDay() };
  if (Object.hasOwn(offsets, key)) return addDays(value, offsets[key]);
  if (key !== "PageUp" && key !== "PageDown") return value;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + (key === "PageUp" ? -1 : 1));
  date.setUTCDate(Math.min(day, daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)));
  return iso(date);
}

export function eventEnd(event) {
  return validDate(event.ends_on) && event.ends_on >= event.starts_on ? event.ends_on : event.starts_on;
}

export function classifyEvent(event) {
  const content = [event.audience, ...(Array.isArray(event.sources) ? event.sources.map((source) => source?.title) : [])].join(" ");
  for (const [category, pattern] of [
    ["holiday", /휴일|공휴일|휴무|설날|추석|holiday/i],
    ["exam", /시험|고사|exam/i], ["enroll", /수강\s*신청|수강\s*정정|course\s*registration/i],
    ["register", /등록|등록금|tuition/i],
  ]) if (pattern.test(content)) return category;
  return "other";
}

export function monthGrid(month) {
  const first = `${month.slice(0, 7)}-01`;
  const date = dateObject(first);
  const start = addDays(first, -date.getUTCDay());
  const count = Math.ceil((date.getUTCDay() + daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)) / 7) * 7;
  return Array.from({ length: count / 7 }, (_, week) => Array.from({ length: 7 }, (_, column) => {
    const value = addDays(start, week * 7 + column);
    return { date: value, outside: value.slice(0, 7) !== first.slice(0, 7), weekend: column === 0 || column === 6 };
  }));
}

export function layoutMonth(events, month, maxRows = 3) {
  if (!Number.isInteger(maxRows) || maxRows < 0) throw new RangeError("막대 줄 수가 올바르지 않습니다.");
  const sorted = events.map((event, index) => ({ event, index }))
    .filter(({ event }) => validDate(event?.starts_on))
    .sort((a, b) => a.event.starts_on.localeCompare(b.event.starts_on) || a.index - b.index);
  return monthGrid(month).map((days) => {
    const bars = [];
    const occupied = [];
    const hidden = Array(7).fill(0);
    for (const { event, index } of sorted) {
      const end = eventEnd(event);
      if (event.starts_on > days[6].date || end < days[0].date) continue;
      const startColumn = days.findIndex((day) => day.date >= event.starts_on);
      let endColumn = 6;
      while (days[endColumn].date > end) endColumn--;
      let row = 0;
      while (occupied[row]?.some(([start, finish]) => start <= endColumn && finish >= startColumn)) row++;
      (occupied[row] ??= []).push([startColumn, endColumn]);
      if (row >= maxRows) {
        for (let column = startColumn; column <= endColumn; column++) hidden[column]++;
      } else bars.push({ event, index, startColumn, endColumn, row,
        category: classifyEvent(event), continuedBefore: event.starts_on < days[0].date, continuedAfter: end > days[6].date });
    }
    return { days, bars, hidden };
  });
}
