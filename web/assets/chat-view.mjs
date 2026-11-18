// 아이오 채팅 화면. 문서 객체, 저장소, 전송 함수, 기록 저장소를 모두 주입받는다.
// 서버가 보낸 글자는 textContent로만 넣는다. 전송·기록 형식은 chat-client·chat-history 계약을 따른다.
import { FAQ, MODES, MODE_LABELS, MODE_STORAGE_KEY, readMode, saveMode, normalizeQuestion } from "./home.mjs";

export const LANGS = Object.freeze(["ko", "en", "zh"]);
export const DEFAULT_LANG = "ko";
export const LANG_STORAGE_KEY = "aio.lang";
export const LANG_LABELS = Object.freeze({ ko: "한국어", en: "English", zh: "中文" });

export const TEXT = Object.freeze({
  toolbar: "대화 설정",
  langLabel: "답변 언어",
  modeGroup: "답변 모드",
  clear: "대화 지우기",
  empty: "아이오에게 학사 규정을 물어보세요. 근거 조문을 함께 보여 드려요.",
  restored: "이 기기에 저장된 대화를 불러왔어요.",
  inputLabel: "아이오에게 질문",
  inputPlaceholder: "예: 휴학 신청은 어디서 하나요?",
  submit: "보내기",
  inputEmpty: "질문을 입력해 주세요.",
  chipsTitle: "추천 질문",
  streaming: "아이오가 답을 쓰고 있어요.",
  fallback: "연결이 불안정해 답을 다시 받는 중이에요.",
  failed: "답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  retry: "다시 묻기",
  saveFailed: "이 기기에 대화를 저장하지 못했어요. 대화는 화면에만 남아요.",
  clearFailed: "이 기기에 저장된 대화를 지우지 못했어요. 잠시 뒤 다시 지워 주세요.",
  citationsTitle: "근거 조문",
  source: "원문 보기 ↗",
  thinking: "생각 과정",
  you: "나",
  aio: "아이오",
});

/** 저장된 답변 언어. 없거나 잘못된 값, 저장소 오류면 ko. */
export function readLang(storage) {
  try {
    const value = storage?.getItem(LANG_STORAGE_KEY);
    return LANGS.includes(value) ? value : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

/** 답변 언어를 저장한다. 저장이 막혀도 화면은 계속 동작한다. */
export function saveLang(storage, lang) {
  if (!LANGS.includes(lang)) throw new RangeError(`unknown lang: ${lang}`);
  try {
    storage?.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // 저장 실패는 무시한다.
  }
}

/** https: 주소만 돌려준다. 그 밖에는 null. 전송 모듈이 거르더라도 화면에서 한 번 더 막는다. */
export function safeSourceUrl(value) {
  if (typeof value !== "string" || /\s/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** 생각 과정 제목. 서버 label(영어·중국어 포함)을 먼저 쓰고, 없으면 걸린 시간으로 만든다. */
export function thinkingTitle(state) {
  const label = typeof state?.thinkingLabel === "string" ? state.thinkingLabel.trim() : "";
  if (label) return label;
  const ms = Number(state?.latencyMs);
  if (Number.isFinite(ms) && ms > 0) return `${Math.max(1, Math.round(ms / 1000))}초 동안 생각함`;
  return TEXT.thinking;
}

const str = (value) => (typeof value === "string" ? value : "");

/** 화면과 기록이 함께 쓰는 답변 상태. 모르는 값은 버린다. */
export function normalizeState(state) {
  const answered = typeof state?.answered === "boolean" ? state.answered : null;
  const guided = state?.guided === true;
  const citations = answered === false || guided || !Array.isArray(state?.citations) ? [] : state.citations
    .filter((c) => c && typeof c === "object")
    .map((c) => ({
      document: str(c.document),
      article: str(c.article),
      snippet: str(c.snippet),
      effectiveDate: str(c.effectiveDate),
      url: safeSourceUrl(c.url),
    }))
    .filter((c) => c.document || c.article || c.snippet);
  const status = ["streaming", "fallback", "done", "failed"].includes(state?.status) ? state.status : "failed";
  return {
    status,
    answer: str(state?.answer),
    thinking: str(state?.thinking),
    thinkingLabel: str(state?.thinkingLabel),
    citations,
    notice: str(state?.notice),
    answered,
    guided,
    sessionId: str(state?.sessionId) || null,
    latencyMs: Number.isFinite(Number(state?.latencyMs)) && state?.latencyMs != null ? Number(state.latencyMs) : null,
    error: state?.error == null ? null : str(state.error) || "error",
  };
}

function el(doc, tag, { className, text, attrs } = {}) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/**
 * 채팅 화면을 root 안에 그린다.
 * @param {{ root: any, doc: any, storage?: Storage,
 *           send: (request: { message: string, mode: string, lang: string, sessionId: string|null,
 *                             signal: AbortSignal, onUpdate: (state: object) => void }) => Promise<object>,
 *           history: { load(): { sessionId: string|null, turns: object[] }, save(state: object): boolean, clear(): void } }} options
 * @returns {{ ask(pending: { question: string, mode?: string }): Promise<object|null>, readonly busy: boolean }}
 */
export function mountChat({ root, doc, storage, send, history }) {
  if (!root || !doc || typeof send !== "function" || !history) {
    throw new TypeError("mountChat needs root, doc, send and history");
  }
  let mode = readMode(storage);
  let lang = readLang(storage);
  let sessionId = null;
  let turns = []; // { question, mode, lang, state, view }
  let active = null; // { controller, turn }
  const seen = new WeakSet();

  // 머리 도구: 언어, 답변 모드, 대화 지우기
  const toolbar = el(doc, "div", { className: "chat-toolbar", attrs: { role: "group", "aria-label": TEXT.toolbar } });
  const langLabel = el(doc, "label", { className: "chat-lang", text: TEXT.langLabel, attrs: { for: "chat-lang" } });
  const langSelect = el(doc, "select", { className: "chat-select", attrs: { id: "chat-lang", name: "lang", "data-lang": "" } });
  for (const value of LANGS) {
    langSelect.append(el(doc, "option", { text: LANG_LABELS[value], attrs: { value } }));
  }
  langSelect.value = lang;
  langSelect.addEventListener("change", () => {
    if (!LANGS.includes(langSelect.value)) {
      langSelect.value = lang;
      return;
    }
    lang = langSelect.value;
    saveLang(storage, lang);
  });
  langLabel.append(langSelect);

  const modeGroup = el(doc, "div", { className: "mode-group", attrs: { role: "group", "aria-label": TEXT.modeGroup } });
  const modeButtons = MODES.map((value) => {
    const button = el(doc, "button", {
      className: `mode-button mode-${value}`,
      text: MODE_LABELS[value],
      attrs: { type: "button", "data-mode": value },
    });
    button.addEventListener("click", () => setMode(value, true));
    return button;
  });
  modeGroup.append(...modeButtons);

  const clearButton = el(doc, "button", {
    className: "button-secondary chat-clear",
    text: TEXT.clear,
    attrs: { type: "button", "data-chat-clear": "" },
  });
  clearButton.addEventListener("click", clear);
  toolbar.append(langLabel, modeGroup, clearButton);

  // 대화 목록과 상태 문구. 스트림 글자는 낭독하지 않고 상태 문구만 알린다.
  const empty = el(doc, "div", { className: "card empty-state chat-empty", attrs: { "data-chat-empty": "" } });
  empty.append(el(doc, "p", { text: TEXT.empty }));
  const log = el(doc, "ol", { className: "chat-log", attrs: { "aria-label": "대화", "data-chat-log": "" } });
  const status = el(doc, "p", { className: "status chat-status", attrs: { "aria-live": "polite", "data-chat-status": "" } });
  status.hidden = true;

  // 추천 질문 칩(홈의 많이 묻는 질문 재사용)
  const chips = el(doc, "section", { className: "chat-chips", attrs: { "aria-labelledby": "chat-chips-title" } });
  chips.append(el(doc, "h2", { className: "section-title", text: TEXT.chipsTitle, attrs: { id: "chat-chips-title" } }));
  const chipList = el(doc, "ul", { className: "chip-list" });
  const chipButtons = FAQ.map((question) => {
    const li = el(doc, "li");
    const button = el(doc, "button", { className: "chip", text: question, attrs: { type: "button", "data-chip": "" } });
    button.addEventListener("click", () => {
      if (!active) run(question, syncMode());
    });
    li.append(button);
    chipList.append(li);
    return button;
  });
  chips.append(chipList);

  // 입력창(본문 흐름에 둔다)
  const form = el(doc, "form", { className: "card chat-form", attrs: { novalidate: "" } });
  const inputLabel = el(doc, "label", { className: "visually-hidden", text: TEXT.inputLabel, attrs: { for: "chat-input" } });
  const input = el(doc, "textarea", {
    className: "ask-input chat-input",
    attrs: { id: "chat-input", name: "message", rows: "2", placeholder: TEXT.inputPlaceholder, "aria-describedby": "chat-error" },
  });
  const inputError = el(doc, "p", { className: "field-error", attrs: { id: "chat-error", "aria-live": "polite" } });
  inputError.hidden = true;
  const submit = el(doc, "button", { className: "button-primary", text: TEXT.submit, attrs: { type: "submit", "data-chat-submit": "" } });
  const formRow = el(doc, "div", { className: "chat-form-row" });
  formRow.append(input, submit);
  form.append(inputLabel, formRow, inputError);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (active) return;
    const question = normalizeQuestion(input.value);
    if (!question) {
      showInputError(true);
      input.focus();
      return;
    }
    showInputError(false);
    input.value = "";
    run(question, syncMode());
  });
  input.addEventListener("input", () => {
    if (!inputError.hidden && normalizeQuestion(input.value)) showInputError(false);
  });

  function showInputError(on) {
    inputError.hidden = !on;
    inputError.textContent = on ? TEXT.inputEmpty : "";
    if (on) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function setMode(value, persist) {
    if (!MODES.includes(value)) return;
    mode = value;
    if (persist) saveMode(storage, value);
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", button.getAttribute("data-mode") === mode ? "true" : "false");
    }
  }

  // 홈과 같은 저장 키를 쓴다. 마지막에 어느 화면에서 골랐든 저장된 값이 기준이다.
  // 저장소가 없거나 읽기가 막히면 fallback(홈이 넘긴 값 또는 현재 값)을 쓴다.
  function syncMode(fallback) {
    let stored = null;
    try {
      stored = storage?.getItem(MODE_STORAGE_KEY) ?? null;
    } catch {
      stored = null;
    }
    const next = MODES.includes(stored) ? stored : MODES.includes(fallback) ? fallback : mode;
    if (next !== mode) setMode(next, false);
    return mode;
  }

  function setStatus(message, state) {
    status.textContent = message ?? "";
    status.hidden = !message;
    status.setAttribute("data-state", state ?? "idle");
  }

  function setBusy(on) {
    submit.disabled = on;
    for (const button of chipButtons) button.disabled = on;
    root.setAttribute?.("aria-busy", on ? "true" : "false");
  }

  function paintEmpty() {
    empty.hidden = turns.length > 0;
  }

  // ---- 한 차례 대화 ----

  function createTurnView(question) {
    const userItem = el(doc, "li", { className: "chat-item chat-user", attrs: { "data-turn": "user" } });
    userItem.append(el(doc, "p", { className: "chat-bubble", text: question }));

    const aioItem = el(doc, "li", { className: "chat-item chat-aio", attrs: { "data-turn": "aio" } });
    const card = el(doc, "article", { className: "card answer-card", attrs: { "aria-label": TEXT.aio, "data-answer": "" } });
    const thinking = el(doc, "details", { className: "thinking", attrs: { "data-thinking": "" } });
    const thinkingSummary = el(doc, "summary", { className: "thinking-summary" });
    const thinkingBody = el(doc, "p", { className: "thinking-body" });
    thinking.append(thinkingSummary, thinkingBody);
    const thinkingNote = el(doc, "p", { className: "thinking-note", attrs: { "data-thinking-note": "" } });
    const answer = el(doc, "p", { className: "answer-body", attrs: { "data-answer-body": "" } });
    const notice = el(doc, "p", { className: "answer-notice", attrs: { "data-notice": "" } });
    const turnStatus = el(doc, "p", { className: "answer-status", attrs: { "data-answer-status": "" } });
    const retry = el(doc, "button", { className: "button-secondary", text: TEXT.retry, attrs: { type: "button", "data-retry": "" } });
    card.append(thinking, thinkingNote, answer, notice, turnStatus, retry);

    const citeSection = el(doc, "section", { className: "citations", attrs: { "data-citations": "" } });
    const citeTitle = el(doc, "h3", { className: "citations-title", text: TEXT.citationsTitle });
    const citeList = el(doc, "ul", { className: "citation-list" });
    citeSection.append(citeTitle, citeList);
    aioItem.append(card, citeSection);

    return { userItem, aioItem, card, thinking, thinkingSummary, thinkingBody, thinkingNote, answer, notice, turnStatus, retry, citeSection, citeList };
  }

  function paintTurn(view, state) {
    view.card.setAttribute("data-status", state.status);
    view.card.setAttribute("data-guided", state.guided ? "true" : "false");
    view.card.setAttribute("aria-busy", state.status === "streaming" || state.status === "fallback" ? "true" : "false");

    // 생각 과정: 원문이 있으면 접기(기본 닫힘, 사용자가 연 상태는 건드리지 않음), 복원 기록이면 제목 한 줄
    const title = thinkingTitle(state);
    view.thinking.hidden = !state.thinking;
    view.thinkingSummary.textContent = title;
    view.thinkingBody.textContent = state.thinking;
    const hasNote = !state.thinking && (state.thinkingLabel || state.latencyMs) && state.status === "done";
    view.thinkingNote.hidden = !hasNote;
    view.thinkingNote.textContent = hasNote ? title : "";

    view.answer.textContent = state.answer;
    view.answer.hidden = !state.answer;
    view.notice.textContent = state.notice;
    view.notice.hidden = !state.notice;

    const message = { streaming: state.answer ? "" : TEXT.streaming, fallback: TEXT.fallback, failed: TEXT.failed }[state.status] ?? "";
    view.turnStatus.textContent = message;
    view.turnStatus.hidden = !message;
    view.turnStatus.setAttribute("data-state", state.status);
    view.retry.hidden = state.status !== "failed";

    view.citeList.replaceChildren(...state.citations.map((citation) => citationItem(doc, citation)));
    view.citeSection.hidden = state.citations.length === 0;
  }

  function addTurn(question, turnMode, turnLang, state) {
    const view = createTurnView(question);
    const turn = { question, mode: turnMode, lang: turnLang, state, view };
    view.retry.addEventListener("click", () => {
      if (active) return;
      removeTurn(turn);
      run(question, turnMode, turnLang);
    });
    turns.push(turn);
    log.append(view.userItem, view.aioItem);
    paintTurn(view, state);
    paintEmpty();
    return turn;
  }

  function removeTurn(turn) {
    turns = turns.filter((t) => t !== turn);
    redrawLog();
  }

  function redrawLog() {
    log.replaceChildren(...turns.flatMap((t) => [t.view.userItem, t.view.aioItem]));
    paintEmpty();
  }

  function persist() {
    // chat-history 계약은 질문을 message로 받는다(요청 본문과 같은 이름).
    const saved = turns.filter((t) => t.state.status === "done").map((t) => ({
      message: t.question,
      mode: t.mode,
      lang: t.lang,
      status: "done",
      answer: t.state.answer,
      thinkingLabel: t.state.thinkingLabel || (t.state.latencyMs ? thinkingTitle(t.state) : ""),
      citations: t.state.citations,
      notice: t.state.notice,
      answered: t.state.answered,
      guided: t.state.guided,
      latencyMs: t.state.latencyMs,
    }));
    const ok = tryHistory(() => history.save({ sessionId, turns: saved }));
    if (!ok) setStatus(TEXT.saveFailed, "save-failed");
    return ok;
  }

  async function run(question, turnMode, turnLang = lang) {
    // 요청을 시작할 때 모드·언어를 고정한다.
    const fixedMode = MODES.includes(turnMode) ? turnMode : mode;
    const fixedLang = LANGS.includes(turnLang) ? turnLang : lang;
    cancelActive();
    const controller = new AbortController();
    const turn = addTurn(question, fixedMode, fixedLang, normalizeState({ status: "streaming" }));
    const mine = { controller, turn };
    active = mine;
    setBusy(true);
    setStatus(TEXT.streaming, "streaming");
    turn.view.aioItem.scrollIntoView?.({ block: "nearest" });

    const update = (raw) => {
      if (active !== mine) return; // 취소되었거나 지워진 대화
      turn.state = normalizeState(raw);
      paintTurn(turn.view, turn.state);
      if (turn.state.status === "fallback") setStatus(TEXT.fallback, "fallback");
    };

    let result;
    try {
      result = await send({ message: question, mode: fixedMode, lang: fixedLang, sessionId, signal: controller.signal, onUpdate: update });
    } catch (error) {
      result = { status: "failed", error: controller.signal.aborted ? "aborted" : String(error?.message ?? error) };
    }
    if (active !== mine) return turn.state;
    active = null;
    if (controller.signal.aborted && result?.status !== "done") result = { ...result, status: "failed", error: "aborted" };
    turn.state = normalizeState(result);
    paintTurn(turn.view, turn.state);
    setBusy(false);
    if (turn.state.status === "done") {
      if (turn.state.sessionId) sessionId = turn.state.sessionId;
      setStatus("", "done");
      persist();
    } else {
      setStatus(TEXT.failed, "failed");
    }
    return turn.state;
  }

  // 진행 중인 요청을 취소하고 그 차례를 실패로 표시한다. 늦게 온 갱신은 run이 버린다.
  function cancelActive() {
    if (!active) return;
    const { controller, turn } = active;
    active = null;
    controller.abort();
    turn.state = normalizeState({ ...turn.state, status: "failed", error: "aborted" });
    paintTurn(turn.view, turn.state);
    setBusy(false);
  }

  // 기록 저장소 호출. false 반환과 예외를 모두 실패로 본다.
  function tryHistory(fn) {
    try {
      return fn() !== false;
    } catch {
      return false;
    }
  }

  function clear() {
    cancelActive();
    // 지우기가 막히면 빈 기록으로 덮어쓴다. 그것도 막히면 다시 열 때 기록이 돌아오므로
    // 화면도 비우지 않고 알린다.
    const cleared = tryHistory(() => history.clear())
      || tryHistory(() => history.save({ sessionId: null, turns: [] }));
    if (!cleared) {
      setStatus(TEXT.clearFailed, "clear-failed");
      return false;
    }
    turns = [];
    sessionId = null;
    redrawLog();
    setStatus("", "idle");
    return true;
  }

  function restore() {
    let saved;
    try {
      saved = history.load();
    } catch {
      return;
    }
    if (!saved || !Array.isArray(saved.turns)) return;
    sessionId = typeof saved.sessionId === "string" && saved.sessionId ? saved.sessionId : null;
    for (const item of saved.turns) {
      const question = normalizeQuestion(item?.message ?? item?.question);
      if (!question) continue;
      const state = normalizeState({ ...item, status: "done", thinking: "" });
      addTurn(question, MODES.includes(item.mode) ? item.mode : mode, LANGS.includes(item.lang) ? item.lang : lang, state);
    }
    if (turns.length) setStatus(TEXT.restored, "restored");
  }

  setMode(mode, false);
  root.replaceChildren(toolbar, empty, log, status, chips, form);
  restore();
  paintEmpty();

  return {
    /** 홈이 넘긴 질문 객체를 실행한다. 같은 객체는 한 번만 실행한다. */
    ask(pending) {
      if (!pending || typeof pending !== "object" || seen.has(pending)) return Promise.resolve(null);
      seen.add(pending);
      const question = normalizeQuestion(pending.question);
      if (!question) return Promise.resolve(null);
      // 홈은 화면을 연 뒤 바뀐 모드를 모를 수 있다. 저장된 값이 있으면 그것을 따른다.
      return run(question, syncMode(pending.mode));
    },
    /** 탭을 다시 열 때 다른 화면에서 바꾼 답변 모드를 반영한다. */
    refresh() {
      syncMode();
    },
    get busy() {
      return active !== null;
    },
  };
}

function citationItem(doc, citation) {
  const li = el(doc, "li", { className: "card citation-card", attrs: { "data-citation": "" } });
  const meta = [citation.document, citation.article, citation.effectiveDate].filter(Boolean);
  if (meta.length) li.append(el(doc, "p", { className: "citation-meta", text: meta.join(" · ") }));
  if (citation.snippet) li.append(el(doc, "blockquote", { className: "citation-snippet", text: citation.snippet }));
  if (citation.url) {
    li.append(el(doc, "a", {
      className: "citation-link",
      text: TEXT.source,
      attrs: { href: citation.url, target: "_blank", rel: "noopener noreferrer" },
    }));
  }
  return li;
}
