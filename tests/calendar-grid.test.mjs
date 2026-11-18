import { test } from "node:test";
import assert from "node:assert/strict";
import { validDate, monthGrid, layoutMonth, classifyEvent, moveDate, eventEnd } from "../web/assets/calendar-grid.mjs";

test("윤년, 세기년, 잘못된 ISO 날짜", () => {
  for (const value of ["2000-02-29", "2024-02-29", "0001-01-01"]) assert.ok(validDate(value));
  for (const value of ["1900-02-29", "2100-02-29", "2027-02-29", "2027-04-31", "0000-01-01", "2027-1-01", null]) assert.equal(validDate(value), false);
  assert.throws(() => moveDate("2027-02-29", "ArrowRight"), TypeError);
});

test("일요일 시작 4·5·6주 격자와 연도 경계", () => {
  assert.equal(monthGrid("2026-02").length, 4);
  assert.equal(monthGrid("2027-03").length, 5);
  assert.equal(monthGrid("2026-05").length, 6);
  const grid = monthGrid("2027-01");
  assert.equal(grid[0][0].date, "2026-12-27");
  assert.equal(grid[0][0].outside, true);
  assert.deepEqual(grid[0].map((day) => day.weekend), [true, false, false, false, false, false, true]);
});

test("주 단위 막대, 겹침과 날짜별 넘침, 입력 불변성", () => {
  const events = [
    { starts_on: "2027-03-01", ends_on: "2027-03-16", audience: "가상 시험" },
    { starts_on: "2027-03-02", ends_on: "2027-03-03" },
    { starts_on: "2027-03-03", ends_on: "2027-03-04" },
    { starts_on: "invalid" },
  ];
  const before = JSON.stringify(events);
  const layout = layoutMonth(events, "2027-03", 2);
  assert.deepEqual(layout[0].bars.map((bar) => [bar.startColumn, bar.endColumn, bar.row]), [[1, 6, 0], [2, 3, 1]]);
  assert.equal(layout[0].bars[0].continuedAfter, true);
  assert.equal(layout[1].bars[0].continuedBefore, true);
  assert.equal(layout[1].bars[0].continuedAfter, true);
  assert.equal(layout[2].bars[0].continuedAfter, false);
  assert.deepEqual(layout[0].hidden, [0, 0, 0, 1, 1, 0, 0]);
  assert.deepEqual(layoutMonth(events, "2027-03", 2), layout);
  assert.equal(JSON.stringify(events), before);
  assert.throws(() => layoutMonth(events, "2027-03", -1), RangeError);
});

test("종료일 포함과 잘못된 종료일 보정", () => {
  for (const ends_on of [undefined, "invalid", "2027-02-29", "2027-02-28"]) {
    const event = { starts_on: "2027-03-01", ends_on };
    assert.equal(eventEnd(event), event.starts_on);
    assert.equal(layoutMonth([event], "2027-03")[0].bars[0].endColumn, 1);
  }
});

test("분류 충돌은 휴일·시험·수강신청·등록 순서", () => {
  assert.equal(classifyEvent({ audience: "수강신청 시험 등록 휴일" }), "holiday");
  assert.equal(classifyEvent({ audience: "수강신청 등록", sources: [{ title: "가상 시험" }] }), "exam");
  assert.equal(classifyEvent({ audience: "수강 신청 등록" }), "enroll");
  assert.equal(classifyEvent({ audience: "등록금" }), "register");
  assert.equal(classifyEvent({ sources: [null] }), "other");
});

test("키보드 날짜 이동과 말일 보정", () => {
  const cases = [
    ["2027-01-31", "PageDown", "2027-02-28"], ["2024-03-31", "PageUp", "2024-02-29"],
    ["2027-12-31", "ArrowRight", "2028-01-01"], ["2027-01-01", "ArrowLeft", "2026-12-31"],
    ["2027-03-03", "Home", "2027-02-28"], ["2027-03-03", "End", "2027-03-06"],
    ["2027-03-03", "ArrowUp", "2027-02-24"], ["2027-03-03", "ArrowDown", "2027-03-10"],
    ["2027-03-03", "Escape", "2027-03-03"],
  ];
  for (const [date, key, expected] of cases) assert.equal(moveDate(date, key), expected);
});
