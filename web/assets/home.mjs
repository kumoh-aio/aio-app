// 홈 화면. 문서 객체, 저장소, 캠퍼스 안내 로더, 이동 함수를 모두 주입받는다.
// 화면에 넣는 글자는 textContent로만 넣는다.
import { createSelectionIndicator } from "./selection-indicator.mjs";

export const MODES = Object.freeze(["fast", "deep"]);
export const DEFAULT_MODE = "fast";
export const MODE_STORAGE_KEY = "aio.answerMode";

export const MODE_LABELS = Object.freeze({ fast: "빠르게", deep: "깊이 생각" });

// 학사 행정 바로가기 8칸. 승인 결과가 바뀌면 이 배열만 고친다.
// draft는 아이오에게 넘길 질문 초안이다. 규정 숫자나 답은 넣지 않는다.
export const SHORTCUTS = Object.freeze([
  Object.freeze({ id: "rules", label: "학사 규정 질문", route: "aio" }),
  Object.freeze({ id: "graduation", label: "졸업 요건", route: "graduation" }),
  Object.freeze({
    id: "registration",
    label: "수강신청·학점",
    route: "aio",
    draft: "수강신청 기간과 신청할 수 있는 학점 기준을 알려 주세요.",
  }),
  Object.freeze({
    id: "leave",
    label: "휴학·복학",
    route: "aio",
    draft: "휴학과 복학은 어떻게 신청하나요?",
  }),
  Object.freeze({
    id: "scholarship",
    label: "장학금",
    route: "aio",
    draft: "장학금 종류와 신청 방법을 알려 주세요.",
  }),
  Object.freeze({
    id: "grades",
    label: "성적·학사경고",
    route: "aio",
    draft: "성적 처리와 학사경고 기준을 알려 주세요.",
  }),
  Object.freeze({
    id: "certificate",
    label: "증명서 발급 안내",
    route: "aio",
    draft: "재학증명서나 성적증명서는 어떻게 발급받나요?",
  }),
  Object.freeze({ id: "calendar", label: "학사일정", route: "calendar" }),
]);

// 많이 묻는 질문. 질문만 적고 답은 아이오가 서버 근거로 한다.
export const FAQ = Object.freeze([
  "졸업하려면 몇 학점을 들어야 하나요?",
  "계절학기 학점도 졸업 학점에 들어가나요?",
  "수강 철회는 언제까지 할 수 있나요?",
  "복수전공은 어떻게 신청하나요?",
  "재수강하면 이전 성적은 어떻게 되나요?",
]);

export const TEXT = Object.freeze({
  askLabel: "아이오에게 물어보세요",
  askPlaceholder: "예: 휴학 신청은 어디서 하나요?",
  askSubmit: "질문하기",
  askEmpty: "질문을 입력해 주세요.",
  modeGroup: "답변 모드",
  shortcutsTitle: "학사 행정 바로가기",
  faqTitle: "많이 묻는 질문",
  campusTitle: "캠퍼스 바로가기",
  campusLoading: "캠퍼스 안내를 불러오는 중이에요. 서버가 깨어나는 데 시간이 걸릴 수 있어요.",
  campusEmpty: "아직 등록된 캠퍼스 안내가 없어요.",
  campusError: "캠퍼스 안내를 불러오지 못했어요.",
  campusRetry: "다시 시도",
});

/** 저장된 답변 모드를 읽는다. 없거나 잘못된 값, 저장소 오류면 fast. */
export function readMode(storage) {
  try {
    const value = storage?.getItem(MODE_STORAGE_KEY);
    return MODES.includes(value) ? value : DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

/** 답변 모드를 저장한다. 사생활 보호 모드 등으로 저장이 막혀도 화면은 계속 동작한다. */
export function saveMode(storage, mode) {
  if (!MODES.includes(mode)) throw new RangeError(`unknown mode: ${mode}`);
  try {
    storage?.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // 저장 실패는 무시한다.
  }
}

/** 앞뒤 공백을 없앤 질문. 비어 있으면 "". */
export function normalizeQuestion(value) {
  return String(value ?? "").trim();
}

/** 캠퍼스 안내 항목 가운데 제목이 있고 https: 링크인 것만 남긴다. */
export function safeGuideItems(items) {
  if (!Array.isArray(items)) return [];
  const result = [];
  for (const item of items) {
    if (!item || typeof item.title !== "string" || typeof item.url !== "string") continue;
    const title = item.title.trim();
    if (!title) continue;
    let url;
    try {
      url = new URL(item.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:") continue;
    const note = typeof item.note === "string" ? item.note.trim() : "";
    result.push({ title, url: url.href, note });
  }
  return result;
}

function el(doc, tag, { className, text, attrs } = {}) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  if (attrs) for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/**
 * 홈 화면을 root 안에 그린다.
 * @param {{ root: any, doc: any, storage?: Storage,
 *           loadCampusGuide: () => Promise<Array<{title: string, url: string, note?: string}>>,
 *           navigate: (route: string, state?: { question: string, mode: string }) => void }} options
 */
export function mountHome({ root, doc, storage, loadCampusGuide, navigate }) {
  if (!root || !doc || typeof loadCampusGuide !== "function" || typeof navigate !== "function") {
    throw new TypeError("mountHome needs root, doc, loadCampusGuide and navigate");
  }
  let mode = readMode(storage);

  // 질문 상자
  const form = el(doc, "form", { className: "card ask-card", attrs: { novalidate: "" } });
  const label = el(doc, "label", { className: "ask-label", text: TEXT.askLabel, attrs: { for: "ask-input" } });
  const input = el(doc, "textarea", {
    className: "ask-input",
    attrs: { id: "ask-input", name: "question", rows: "3", placeholder: TEXT.askPlaceholder, "aria-describedby": "ask-error" },
  });
  const error = el(doc, "p", { className: "field-error", attrs: { id: "ask-error", "aria-live": "polite" } });
  error.hidden = true;

  const modeGroup = el(doc, "div", { className: "mode-group", attrs: { role: "group", "aria-label": TEXT.modeGroup } });
  const modeButtons = MODES.map((value) => {
    const button = el(doc, "button", {
      className: `mode-button mode-${value}`,
      text: MODE_LABELS[value],
      attrs: { type: "button", "data-mode": value },
    });
    button.addEventListener("click", () => setMode(value));
    return button;
  });
  modeGroup.append(...modeButtons);
  const updateIndicator = createSelectionIndicator(modeGroup, modeButtons);

  const submit = el(doc, "button", { className: "button-primary", text: TEXT.askSubmit, attrs: { type: "submit" } });
  const actions = el(doc, "div", { className: "ask-actions" });
  actions.append(modeGroup, submit);
  form.append(label, input, error, actions);

  function paintMode(animate = false) {
    for (const button of modeButtons) {
      const active = button.getAttribute("data-mode") === mode;
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
    updateIndicator(modeButtons[MODES.indexOf(mode)], animate);
  }

  function setMode(value) {
    if (!MODES.includes(value)) return;
    mode = value;
    saveMode(storage, value);
    paintMode(true);
  }

  function showError(on) {
    error.hidden = !on;
    error.textContent = on ? TEXT.askEmpty : "";
    if (on) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function ask(question) {
    navigate("aio", { question, mode });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = normalizeQuestion(input.value);
    if (!question) {
      showError(true);
      input.focus();
      return;
    }
    showError(false);
    input.value = "";
    ask(question);
  });
  input.addEventListener("input", () => {
    if (!error.hidden && normalizeQuestion(input.value)) showError(false);
  });

  // 학사 행정 바로가기 8칸
  const shortcutSection = section(doc, "shortcuts-title", TEXT.shortcutsTitle);
  const grid = el(doc, "ul", { className: "shortcut-grid" });
  for (const item of SHORTCUTS) {
    const li = el(doc, "li");
    const button = el(doc, "button", {
      className: "tile",
      text: item.label,
      attrs: { type: "button", "data-shortcut": item.id },
    });
    button.addEventListener("click", () => {
      if (item.draft) ask(item.draft);
      else navigate(item.route);
    });
    li.append(button);
    grid.append(li);
  }
  shortcutSection.append(grid);

  // 많이 묻는 질문
  const faqSection = section(doc, "faq-title", TEXT.faqTitle);
  const faqList = el(doc, "ul", { className: "faq-list" });
  for (const question of FAQ) {
    const li = el(doc, "li");
    const button = el(doc, "button", { className: "faq-item", text: question, attrs: { type: "button", "data-faq": "" } });
    button.addEventListener("click", () => ask(question));
    li.append(button);
    faqList.append(li);
  }
  faqSection.append(faqList);

  // 캠퍼스 바로가기
  const campusSection = section(doc, "campus-title", TEXT.campusTitle);
  const status = el(doc, "p", { className: "status", attrs: { "aria-live": "polite", "data-campus-status": "" } });
  const campusList = el(doc, "ul", { className: "campus-list" });
  const retry = el(doc, "button", {
    className: "button-secondary",
    text: TEXT.campusRetry,
    attrs: { type: "button", "data-campus-retry": "" },
  });
  retry.hidden = true;
  retry.addEventListener("click", () => {
    loadCampus();
  });
  campusSection.append(status, campusList, retry);

  let loadToken = 0;
  async function loadCampus() {
    const token = ++loadToken;
    setCampusState("loading");
    campusList.replaceChildren();
    let items;
    try {
      items = safeGuideItems(await loadCampusGuide());
    } catch {
      if (token === loadToken) setCampusState("error");
      return;
    }
    if (token !== loadToken) return; // 더 최근 요청이 있으면 버린다
    if (items.length === 0) {
      setCampusState("empty");
      return;
    }
    campusList.replaceChildren(...items.map((item) => guideItem(doc, item)));
    setCampusState("ready");
  }

  function setCampusState(state) {
    status.setAttribute("data-state", state);
    campusSection.setAttribute("aria-busy", state === "loading" ? "true" : "false");
    const message = { loading: TEXT.campusLoading, empty: TEXT.campusEmpty, error: TEXT.campusError }[state] ?? "";
    status.textContent = message;
    status.hidden = !message;
    retry.hidden = state !== "error";
  }

  root.replaceChildren(form, shortcutSection, faqSection, campusSection);
  paintMode();
  const ready = loadCampus();

  return {
    ready,
    reload: loadCampus,
    refreshMode(value) {
      if (MODES.includes(value)) mode = value;
      paintMode();
    },
    get mode() {
      return mode;
    },
  };
}

function section(doc, headingId, title) {
  const node = el(doc, "section", { className: "home-section", attrs: { "aria-labelledby": headingId } });
  node.append(el(doc, "h2", { className: "section-title", text: title, attrs: { id: headingId } }));
  return node;
}

function guideItem(doc, item) {
  const li = el(doc, "li");
  const link = el(doc, "a", {
    className: "card campus-link",
    attrs: { href: item.url, target: "_blank", rel: "noopener noreferrer" },
  });
  link.append(el(doc, "span", { className: "campus-title", text: item.title }));
  if (item.note) link.append(el(doc, "span", { className: "campus-note", text: item.note }));
  li.append(link);
  return li;
}
