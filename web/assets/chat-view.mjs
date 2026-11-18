// 아이오 채팅 화면. 문서 객체, 저장소, 전송 함수, 기록 저장소를 모두 주입받는다.
// 서버가 보낸 글자는 textContent로만 넣는다. 전송·기록 형식은 chat-client·chat-history 계약을 따른다.
import { FAQ, MODES, MODE_LABELS, MODE_STORAGE_KEY, readMode, saveMode, normalizeQuestion } from "./home.mjs";
import { createQuickActions } from "./quick-actions.mjs";
import { createSelectionIndicator } from "./selection-indicator.mjs";

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
  stop: "중단",
  stopLabel: "응답 중단",
  stopped: "응답을 중단했습니다.",
  pen: "손글씨로 입력",
  inputEmpty: "질문을 입력해 주세요.",
  chipsTitle: "추천 질문",
  streaming: "아이오가 답을 쓰고 있어요.",
  fallback: "연결이 불안정해 답을 다시 받는 중이에요.",
  failed: "답을 받지 못했어요. 잠시 뒤 다시 시도해 주세요.",
  retry: "다시 묻기",
  edit: "수정",
  editLabel: "질문 수정",
  editSubmit: "고쳐서 묻기",
  editCancel: "취소",
  regenerate: "다시 답하기",
  versions: "질문·답변 버전",
  prevVersion: "이전 버전",
  nextVersion: "다음 버전",
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

// 저장된 답변 모드. 없거나 잘못된 값, 읽기 오류면 null(readMode와 달리 기본값을 채우지 않는다).
function storedMode(storage) {
  try {
    const value = storage?.getItem(MODE_STORAGE_KEY);
    return MODES.includes(value) ? value : null;
  } catch {
    return null;
  }
}

const PREF_KEYS = Object.freeze([MODE_STORAGE_KEY, LANG_STORAGE_KEY]);

/**
 * 홈과 아이오가 함께 쓰는 설정 저장소. 모드·언어 키는 메모리에 먼저 적어 두므로
 * 기기 저장이 막혀도 두 화면이 같은 값을 읽는다. 쓰기 오류는 그대로 던져 호출자가 처리한다.
 * 대화 기록처럼 용량 오류를 직접 다뤄야 하는 키는 감싸지 않으므로 기록 모듈에는 원래 저장소를 준다.
 */
export function createPrefStorage(storage, keys = PREF_KEYS) {
  const memory = new Map();
  return {
    getItem(key) {
      if (keys.includes(key) && memory.has(key)) return memory.get(key);
      return storage ? storage.getItem(key) : null;
    },
    setItem(key, value) {
      if (keys.includes(key)) memory.set(key, String(value));
      if (storage) storage.setItem(key, value);
      else if (!keys.includes(key)) throw new Error("storage unavailable");
    },
    removeItem(key) {
      memory.delete(key);
      storage?.removeItem?.(key);
    },
  };
}

/**
 * 홈을 열 때 저장된 모드와 표시 위치를 맞춘다. 모드가 바뀌었으면 true.
 */
export function syncHomeMode({ home, storage }) {
  if (!home) return false;
  const previousMode = home.mode;
  home.refreshMode?.(storedMode(storage));
  return home.mode !== previousMode;
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
 *           history: { load(): { sessionId: string|null, turns: { selectedVersion: number, versions: object[] }[] },
 *                      save(state: object): boolean, clear(): void },
 *           handwriting?: { open(options: { trigger: any, lang: string, onInsert: (text: string) => void }): void },
 *           quickActions?: { id: string, label: object, run?: Function }[],
 *           sendIcon?: (button: any) => { setStopping(on: boolean): void } }} options
 *   handwriting(선택): 손글씨 패드. 없으면 펜 버튼을 그리지 않는다.
 * @returns {{ ask(pending: { question: string, mode?: string }): Promise<object|null>, closeQuickActions(): void, readonly busy: boolean }}
 */
export function mountChat({ root, doc, storage, send, history, handwriting, quickActions, sendIcon }) {
  if (!root || !doc || typeof send !== "function" || !history) {
    throw new TypeError("mountChat needs root, doc, send and history");
  }
  let mode = readMode(storage);
  let seenStored = storedMode(storage);
  let pickedHere = false; // 이 화면에서 사용자가 모드를 골랐는지
  let lang = readLang(storage);
  let sessionId = null;
  // 차례: { versions: 완료된 { question, mode, lang, state }[] (오래된 순), selected, pending, view }
  // pending은 받는 중이거나, 완료 버전이 없는 차례에서 실패한 시도다. 화면은 pending이 있으면 그것을 그린다.
  let turns = [];
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
    updateQuickActionsName();
    updateModeIndicator();
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
  const updateIndicator = createSelectionIndicator(modeGroup, modeButtons);

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
  const submit = el(doc, "button", {
    className: "button-primary chat-send",
    attrs: { type: "submit", "data-chat-submit": "", "data-state": "send", "aria-label": TEXT.submit },
  });
  const submitLabel = el(doc, "span", { className: "chat-send-label", text: TEXT.submit });
  submit.append(submitLabel);
  const submitIcon = sendIcon?.(submit);
  submit.addEventListener("click", (event) => {
    if (!active) return;
    // 중단하면서 type이 submit으로 돌아가도 이 클릭으로 폼을 제출하지 않는다.
    event.preventDefault();
    cancelActive();
    setStatus(TEXT.stopped, "stopped");
    submit.focus();
  });
  const formRow = el(doc, "div", { className: "chat-form-row" });
  // 손글씨 펜 버튼은 입력창과 보내기 사이에 둔다. textarea에는 덮개·포인터 처리기·터치 동작 CSS를
  // 더하지 않는다(iPad Scribble 같은 기기 손글씨 입력이 그대로 동작해야 한다).
  const pen = typeof handwriting?.open === "function" ? createPenButton() : null;
  formRow.append(...(pen ? [input, pen, submit] : [input, submit]));
  let ring = null;
  let quickButton = null;
  if (Array.isArray(quickActions)) {
    const actions = quickActions.filter((action) => action.id !== "handwriting" || pen)
      .map((action) => action.id === "handwriting"
        ? { ...action, run: ({ trigger }) => openHandwriting(trigger) }
        : action);
    ring = createQuickActions({ doc, actions });
    quickButton = el(doc, "button", {
      className: "chat-plus",
      text: "+",
      attrs: { type: "button", "data-chat-quick-actions": "", "aria-haspopup": "menu",
        "aria-expanded": "false", "aria-controls": ring.element.id },
    });
    updateQuickActionsName();
    quickButton.addEventListener("click", () => ring.toggle(quickButton, { lang }));
    quickButton.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        ring.open(quickButton, { lang });
      }
    });
    formRow.replaceChildren(quickButton, input, ...(pen ? [pen] : []), submit);
  }
  form.append(inputLabel, formRow, inputError);
  if (ring) form.append(ring.element);

  function updateQuickActionsName() {
    quickButton?.setAttribute("aria-label", {
      ko: "빠른 실행", en: "Quick actions", zh: "快捷操作",
    }[lang]);
  }

  function openHandwriting(trigger) {
    const length = input.value.length;
    const end = clampIndex(input.selectionEnd, length, length);
    const start = Math.min(clampIndex(input.selectionStart, length, end), end);
    handwriting.open({ trigger, lang, onInsert: (text) => insertText(text, start, end) });
  }

  function createPenButton() {
    const button = el(doc, "button", {
      className: "chat-pen",
      attrs: { type: "button", "aria-label": TEXT.pen, "aria-haspopup": "dialog", "data-chat-pen": "" },
    });
    button.append(el(doc, "span", { className: "chat-pen-icon", text: "✎", attrs: { "aria-hidden": "true" } }));
    button.addEventListener("click", () => openHandwriting(button));
    return button;
  }

  function clampIndex(value, length, fallback) {
    return Number.isInteger(value) ? Math.max(0, Math.min(value, length)) : fallback;
  }

  // 받은 글자를 선택 범위에 넣고 커서를 그 뒤에 둔다. 전송하지 않는다.
  function insertText(text, start, end) {
    if (typeof text !== "string" || !text) return;
    const length = input.value.length;
    const to = Math.min(end, length);
    const from = Math.min(start, to);
    if (typeof input.setRangeText === "function") {
      input.setRangeText(text, from, to, "end");
    } else {
      input.value = input.value.slice(0, from) + text + input.value.slice(to);
    }
    // 오류 표시는 input 처리기가 갱신한다.
    const EventCtor = doc.defaultView?.Event ?? globalThis.Event;
    input.dispatchEvent?.(new EventCtor("input", { bubbles: true }));
    input.focus();
  }
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
    if (persist) {
      saveMode(storage, value);
      pickedHere = true;
    }
    // 쓰기가 막혔다면 예전 값이 그대로 남는다. 그 값을 "본 값"으로 기억해 다른 화면의 변경과 구분한다.
    seenStored = storedMode(storage);
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", button.getAttribute("data-mode") === mode ? "true" : "false");
    }
    updateModeIndicator(persist);
  }

  function updateModeIndicator(animate = false) {
    updateIndicator(modeButtons[MODES.indexOf(mode)], animate);
  }

  // 홈과 같은 저장 키를 쓴다. 마지막으로 본 저장값과 달라졌을 때만 다른 화면이 바꾼 것으로 보고 따른다.
  // 저장값이 그대로면(쓰기 실패 포함) 이 화면에서 고른 값을 지킨다. 저장소를 못 쓰면 fallback(홈이 넘긴 값)을 쓴다.
  function syncMode(fallback, realign = false) {
    const stored = storedMode(storage);
    if (stored && stored !== seenStored) {
      setMode(stored, false);
      pickedHere = false;
    } else if (!stored && !pickedHere && MODES.includes(fallback)) {
      setMode(fallback, false); // 저장값이 전혀 없을 때만 홈이 넘긴 값을 쓰고, 여기서 고른 값은 지킨다
    } else if (realign) {
      updateModeIndicator();
    }
    return mode;
  }

  function setStatus(message, state) {
    status.textContent = message ?? "";
    status.hidden = !message;
    status.setAttribute("data-state", state ?? "idle");
  }

  function setBusy(on) {
    submit.setAttribute("type", on ? "button" : "submit");
    submit.setAttribute("data-state", on ? "stop" : "send");
    submit.setAttribute("aria-label", on ? TEXT.stopLabel : TEXT.submit);
    if (submitIcon) submitIcon.setStopping(on);
    else submitLabel.textContent = on ? TEXT.stop : TEXT.submit;
    for (const button of chipButtons) button.disabled = on;
    root.setAttribute?.("aria-busy", on ? "true" : "false");
    for (const turn of turns) paintControls(turn);
  }

  function paintEmpty() {
    empty.hidden = turns.length > 0;
  }

  // ---- 한 차례 대화 ----

  function createTurnView() {
    const userItem = el(doc, "li", { className: "chat-item chat-user", attrs: { "data-turn": "user" } });
    const bubble = el(doc, "p", { className: "chat-bubble", attrs: { "data-question": "" } });

    // 질문 고치기. 열면 말풍선 대신 입력칸을 보여 준다.
    const editForm = el(doc, "form", { className: "chat-edit", attrs: { novalidate: "", "data-edit-form": "" } });
    // 차례마다 id를 만들지 않도록 이름은 aria-label로 붙인다.
    const editInput = el(doc, "textarea", {
      className: "ask-input chat-edit-input",
      attrs: { name: "message", rows: "2", "aria-label": TEXT.editLabel, "data-edit-input": "" },
    });
    const editRow = el(doc, "div", { className: "chat-edit-row" });
    const editCancel = el(doc, "button", { className: "button-secondary", text: TEXT.editCancel, attrs: { type: "button", "data-edit-cancel": "" } });
    const editSubmit = el(doc, "button", { className: "button-primary", text: TEXT.editSubmit, attrs: { type: "submit", "data-edit-submit": "" } });
    editRow.append(editCancel, editSubmit);
    editForm.append(editInput, editRow);
    editForm.hidden = true;

    // 수정 버튼과 "‹ n/m ›" 버전 넘기기
    const actions = el(doc, "div", { className: "turn-actions", attrs: { "data-turn-actions": "" } });
    const edit = el(doc, "button", { className: "turn-action", text: TEXT.edit, attrs: { type: "button", "data-edit": "" } });
    const nav = el(doc, "div", { className: "version-nav", attrs: { role: "group", "aria-label": TEXT.versions, "data-versions": "" } });
    const prev = el(doc, "button", { className: "version-step", text: "‹", attrs: { type: "button", "aria-label": TEXT.prevVersion, "data-version-prev": "" } });
    const versionLabel = el(doc, "span", { className: "version-label", attrs: { "data-version-label": "" } });
    const next = el(doc, "button", { className: "version-step", text: "›", attrs: { type: "button", "aria-label": TEXT.nextVersion, "data-version-next": "" } });
    nav.append(prev, versionLabel, next);
    actions.append(edit, nav);
    userItem.append(bubble, editForm, actions);

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
    const regenerate = el(doc, "button", { className: "button-secondary", text: TEXT.regenerate, attrs: { type: "button", "data-regenerate": "" } });
    const answerActions = el(doc, "div", { className: "answer-actions" });
    answerActions.append(retry, regenerate);
    card.append(thinking, thinkingNote, answer, notice, turnStatus, answerActions);

    const citeSection = el(doc, "section", { className: "citations", attrs: { "data-citations": "" } });
    const citeTitle = el(doc, "h3", { className: "citations-title", text: TEXT.citationsTitle });
    const citeList = el(doc, "ul", { className: "citation-list" });
    citeSection.append(citeTitle, citeList);
    aioItem.append(card, citeSection);

    return {
      userItem, bubble, editForm, editInput, editCancel, editSubmit, actions, edit, nav, prev, versionLabel, next,
      aioItem, card, thinking, thinkingSummary, thinkingBody, thinkingNote, answer, notice, turnStatus, retry, regenerate,
      citeSection, citeList,
    };
  }

  // 지금 그릴 시도: 받는 중이거나 실패한 시도가 있으면 그것, 아니면 고른 완료 버전.
  const shown = (turn) => turn.pending ?? turn.versions[turn.selected];

  function paintTurn(turn) {
    const { view } = turn;
    const attempt = shown(turn);
    view.bubble.textContent = attempt.question;
    paintAnswer(view, attempt.state);
    paintControls(turn);
  }

  // 답을 받는 동안에는 차례 조작을 모두 막는다. 처리기에서도 active를 한 번 더 거른다.
  function paintControls(turn) {
    const { view } = turn;
    const busy = active !== null;
    const settled = !turn.pending && turn.versions.length > 0;
    const count = turn.versions.length;
    view.edit.hidden = !settled;
    view.regenerate.hidden = !settled;
    view.nav.hidden = !settled || count < 2;
    view.versionLabel.textContent = `${turn.selected + 1}/${count}`;
    lock(view.edit, busy);
    lock(view.regenerate, busy);
    lock(view.retry, busy);
    lock(view.editSubmit, busy);
    lock(view.prev, busy || turn.selected <= 0);
    lock(view.next, busy || turn.selected >= count - 1);
    if (!settled) closeEditor(turn, false);
  }

  function lock(button, on) {
    button.disabled = on;
    if (on) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }

  function openEditor(turn) {
    if (active || turn.pending) return;
    const { view } = turn;
    view.editInput.value = shown(turn).question;
    view.editInput.removeAttribute("aria-invalid");
    view.editForm.hidden = false;
    view.bubble.hidden = true;
    view.actions.hidden = true;
    view.editInput.focus();
  }

  function closeEditor(turn, refocus) {
    const { view } = turn;
    if (view.editForm.hidden) return;
    view.editForm.hidden = true;
    view.bubble.hidden = false;
    view.actions.hidden = false;
    if (refocus) view.edit.focus();
  }

  function selectVersion(turn, index) {
    if (active || turn.pending || index < 0 || index >= turn.versions.length || index === turn.selected) return;
    turn.selected = index;
    closeEditor(turn, false);
    paintTurn(turn);
    persist(); // 요청은 보내지 않고 고른 버전만 저장한다
  }

  function paintAnswer(view, state) {
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

  // versions가 비어 있으면 pending을 하나 받아 새 시도로 시작한다.
  function addTurn({ versions = [], selected = versions.length - 1, pending = null }) {
    const view = createTurnView();
    const turn = { versions, selected, pending, view };

    // 완료 버전이 없는 차례의 다시 묻기: 그 차례를 지우고 대화 끝에서 다시 묻는다.
    view.retry.addEventListener("click", () => {
      if (active || !turn.pending) return;
      const { question, mode: turnMode, lang: turnLang } = turn.pending;
      removeTurn(turn);
      run(question, turnMode, turnLang);
    });
    view.edit.addEventListener("click", () => openEditor(turn));
    view.editCancel.addEventListener("click", () => closeEditor(turn, true));
    view.editInput.addEventListener("keydown", (event) => {
      if (event?.key === "Escape") closeEditor(turn, true);
    });
    view.editForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (active || turn.pending) return;
      const question = normalizeQuestion(view.editInput.value);
      if (!question) {
        view.editInput.setAttribute("aria-invalid", "true");
        view.editInput.focus();
        return;
      }
      closeEditor(turn, false);
      run(question, syncMode(), lang, turn);
    });
    view.regenerate.addEventListener("click", () => {
      if (active || turn.pending) return;
      run(shown(turn).question, syncMode(), lang, turn);
    });
    const step = (delta, from, to) => {
      selectVersion(turn, turn.selected + delta);
      if (from.disabled) to.focus(); // 끝에 닿아 버튼이 막히면 반대쪽으로 포커스를 옮긴다
    };
    view.prev.addEventListener("click", () => step(-1, view.prev, view.next));
    view.next.addEventListener("click", () => step(1, view.next, view.prev));

    turns.push(turn);
    log.append(view.userItem, view.aioItem);
    paintTurn(turn);
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

  // chat-history v2 계약: 차례마다 { selectedVersion, versions: [snapshot] }. 질문은 message로 담는다.
  function snapshot({ question, mode: turnMode, lang: turnLang, state }) {
    return {
      message: question,
      mode: turnMode,
      lang: turnLang,
      status: "done",
      answer: state.answer,
      thinkingLabel: state.thinkingLabel || (state.latencyMs ? thinkingTitle(state) : ""),
      citations: state.citations,
      notice: state.notice,
      answered: state.answered,
      guided: state.guided,
      sessionId: state.sessionId,
      latencyMs: state.latencyMs,
    };
  }

  function persist() {
    const saved = turns.filter((t) => t.versions.length > 0).map((t) => ({
      selectedVersion: t.selected,
      versions: t.versions.map(snapshot),
    }));
    const ok = tryHistory(() => history.save({ sessionId, turns: saved }));
    if (!ok) setStatus(TEXT.saveFailed, "save-failed");
    return ok;
  }

  // target이 있으면 그 차례에 새 버전을 받는다(수정·다시 답하기). 없으면 대화 끝에 새 차례를 붙인다.
  async function run(question, turnMode, turnLang = lang, target = null) {
    // 요청을 시작할 때 모드·언어를 고정한다.
    const fixedMode = MODES.includes(turnMode) ? turnMode : mode;
    const fixedLang = LANGS.includes(turnLang) ? turnLang : lang;
    cancelActive();
    const controller = new AbortController();
    const attempt = { question, mode: fixedMode, lang: fixedLang, state: normalizeState({ status: "streaming" }) };
    let turn = target && turns.includes(target) ? target : null;
    const mine = { controller, turn: null };
    active = mine;
    if (turn) {
      turn.pending = attempt;
      paintTurn(turn);
    } else {
      turn = addTurn({ pending: attempt });
    }
    mine.turn = turn;
    setBusy(true);
    setStatus(TEXT.streaming, "streaming");
    turn.view.aioItem.scrollIntoView?.({ block: "nearest" });

    const update = (raw) => {
      if (active !== mine) return; // 취소되었거나 지워진 대화
      attempt.state = normalizeState(raw);
      paintTurn(turn);
      if (attempt.state.status === "fallback") setStatus(TEXT.fallback, "fallback");
    };

    let result;
    try {
      result = await send({ message: question, mode: fixedMode, lang: fixedLang, sessionId, signal: controller.signal, onUpdate: update });
    } catch (error) {
      result = { status: "failed", error: controller.signal.aborted ? "aborted" : String(error?.message ?? error) };
    }
    if (active !== mine) return attempt.state;
    active = null;
    if (controller.signal.aborted && result?.status !== "done") result = { ...result, status: "failed", error: "aborted" };
    attempt.state = normalizeState(result);
    if (attempt.state.status === "done") {
      turn.versions.push(attempt);
      turn.selected = turn.versions.length - 1;
      turn.pending = null;
    } else {
      settleFailed(turn, attempt);
    }
    paintTurn(turn);
    setBusy(false);
    if (attempt.state.status === "done") {
      if (attempt.state.sessionId) sessionId = attempt.state.sessionId;
      setStatus("", "done");
      persist();
    } else {
      setStatus(TEXT.failed, "failed");
    }
    return attempt.state;
  }

  // 실패·취소한 시도: 완료 버전이 있으면 버리고 고른 버전을 다시 보여 주고, 없으면 실패로 남겨 다시 묻기를 띄운다.
  function settleFailed(turn, attempt) {
    if (turn.versions.length > 0) {
      turn.pending = null;
    } else {
      attempt.state = normalizeState({ ...attempt.state, status: "failed", error: attempt.state.error || "aborted" });
      turn.pending = attempt;
    }
  }

  // 진행 중인 요청을 취소한다. 늦게 온 갱신은 run이 버린다.
  function cancelActive() {
    if (!active) return;
    const { controller, turn } = active;
    active = null;
    controller.abort();
    if (turn?.pending) {
      settleFailed(turn, turn.pending);
      paintTurn(turn);
    }
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
      // v2 차례는 versions를 갖는다. versions가 없는 예전 모양은 버전 하나짜리 차례로 읽는다.
      const raw = Array.isArray(item?.versions) ? item.versions : [item];
      const kept = [];
      let selected = -1;
      raw.forEach((entry, index) => {
        const version = restoreVersion(entry);
        if (!version) return;
        if (index === item?.selectedVersion) selected = kept.length;
        kept.push(version);
      });
      if (!kept.length) continue;
      // 고른 버전이 걸러졌거나 값이 잘못됐으면 가장 최근 버전을 고른다.
      addTurn({ versions: kept, selected: selected >= 0 ? selected : kept.length - 1 });
    }
    if (turns.length) setStatus(TEXT.restored, "restored");
  }

  function restoreVersion(entry) {
    if (!entry || typeof entry !== "object") return null;
    const question = normalizeQuestion(entry.message ?? entry.question);
    if (!question) return null;
    return {
      question,
      mode: MODES.includes(entry.mode) ? entry.mode : mode,
      lang: LANGS.includes(entry.lang) ? entry.lang : lang,
      state: normalizeState({ ...entry, status: "done", thinking: "" }),
    };
  }

  root.replaceChildren(toolbar, empty, log, status, chips, form);
  setMode(mode, false);
  restore();
  paintEmpty();

  return {
    /** 홈이 넘긴 질문 객체를 실행한다. 같은 객체는 한 번만 실행한다. */
    ask(pending) {
      if (!pending || typeof pending !== "object" || seen.has(pending)) {
        updateModeIndicator();
        return Promise.resolve(null);
      }
      seen.add(pending);
      const question = normalizeQuestion(pending.question);
      if (!question) {
        updateModeIndicator();
        return Promise.resolve(null);
      }
      // 홈은 화면을 연 뒤 바뀐 모드를 모를 수 있다. 저장된 값이 있으면 그것을 따른다.
      return run(question, syncMode(pending.mode, true));
    },
    /** 탭을 다시 열 때 다른 화면에서 바꾼 답변 모드를 반영한다. */
    refresh() {
      syncMode(undefined, true);
    },
    closeQuickActions() {
      ring?.close(false);
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
