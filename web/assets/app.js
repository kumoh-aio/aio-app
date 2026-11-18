// 부팅과 서비스 워커 등록만 맡는다. 테스트에서는 불러오지 않는다.
import { API_BASE } from "./config.mjs";
import { createApi } from "./api.mjs";
import { createRouter } from "./router.mjs";
import { mountHome } from "./home.mjs";
import { createChatClient } from "./chat-client.mjs";
import { createChatHistory } from "./chat-history.mjs";
import { mountChat, createPrefStorage, syncHomeMode } from "./chat-view.mjs";
import { mountDemoLogin } from "./demo-login.mjs";
import { mountGraduationDiagnosis } from "./graduation-view.mjs";
import { mountCalendar } from "./calendar-view.mjs";
import { mountAppearance } from "./appearance.mjs";
import { createHandwritingPad } from "./handwriting-pad.mjs";
import { createSelectionIndicator } from "./selection-indicator.mjs";

const fetchImpl = globalThis.fetch.bind(globalThis);
const api = createApi({ base: API_BASE, fetchImpl });
const chatClient = createChatClient({ base: API_BASE, fetchImpl });

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 저장소 접근이 막힌 환경
  }
}

const storage = safeStorage();
mountAppearance({ doc: document, storage });
// 답변 모드·언어는 홈과 아이오가 같은 값을 보도록 메모리를 겸한 설정 저장소로 공유한다.
// 대화 기록은 용량 오류를 직접 다뤄야 하므로 원래 저장소를 그대로 쓴다.
const prefs = createPrefStorage(storage);
const homeRoot = document.getElementById("home-root");

// 전송 화살표 ↔ 정지 ■ 모핑은 동적 import로 불러온다. 이전 셸 캐시(v11)의 워커가 아직 제어하는 동안에는
// 새 app.js만 저장되고 send-icon.mjs는 저장되지 않는다. 정적 import면 오프라인에서 앱 전체가 시작되지 않는다.
// 채팅을 그리기 전에 결과를 기다린다. 못 불러오면 sendIcon을 넘기지 않아 chat-view가 글자("보내기"↔"중단")를 바꾼다.
// 팩터리를 먼저 넘기고 나중에 실패하면 chat-view는 아이콘이 있다고 보고 글자 갱신을 건너뛴다.
const sendIconModule = await import("./send-icon.mjs").catch(() => null);
const sendIcon = typeof sendIconModule?.mountSendIcon === "function"
  ? (button) => sendIconModule.mountSendIcon(button, { doc: document, win: window })
  : undefined;

const handwriting = createHandwritingPad({
  doc: document,
  recognize: (request) => api.handwriting(request),
});

// 라우터보다 먼저 그려 둔다. 첫 화면이 #/aio여도 ask를 받을 수 있다.
const chat = mountChat({
  root: document.getElementById("chat-root"),
  doc: document,
  storage: prefs,
  send: (request) => chatClient.send(request),
  history: createChatHistory({ storage }),
  handwriting,
  sendIcon,
  quickActions: [
    { id: "calendar", label: { ko: "학사일정", en: "Calendar", zh: "校历" },
      run: () => router.navigate("calendar") },
    { id: "graduation", label: { ko: "졸업 진단", en: "Graduation", zh: "毕业诊断" },
      run: () => router.navigate("graduation") },
    { id: "biskit", label: { ko: "BISKIT 추천", en: "BISKIT picks", zh: "BISKIT 推荐" },
      run: () => router.navigate("graduation", { section: "recommendations" }) },
    { id: "handwriting", label: { ko: "손글씨 입력", en: "Handwriting", zh: "手写输入" } },
  ],
});

const diagnosis = mountGraduationDiagnosis({
  root: document.getElementById("graduation-root"),
  doc: document,
  loadDiagnosis: (studentId) => api.graduationDemo(studentId),
  onAsk: () => router.navigate("aio", { question: "졸업 요건과 확인 방법을 알려 주세요." }),
});
const demoLogin = mountDemoLogin({
  root: document.getElementById("graduation-login-root"),
  doc: document,
  loadStudents: () => api.demoStudents(),
  login: (studentId) => api.demoLogin(studentId),
  diagnosis,
});
// 학기 선택·재시도·늦은 응답 무시는 일정 모듈이 맡는다. 탭 진입 때는 refresh()만 부른다.
const calendar = mountCalendar({
  root: document.getElementById("calendar-root"),
  doc: document,
  fetchImpl,
  base: API_BASE,
  initialYear: 2027,
  initialTerm: 1,
});

let home = null;
let firstRender = true;
const tabs = document.querySelectorAll("[data-tab]");
const updateTabIndicator = createSelectionIndicator(document.querySelector(".tab-bar"), tabs);
let clickedTab = null;

for (const tab of tabs) {
  tab.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
      || event.altKey || event.shiftKey || tab.getAttribute("aria-current") === "page") return;
    clickedTab = tab;
  });
}

function showView({ route, state }) {
  if (route !== "aio") {
    handwriting.close();
    chat.closeQuickActions();
  }
  for (const view of document.querySelectorAll("[data-view]")) {
    view.hidden = view.getAttribute("data-view") !== route;
  }
  let activeTab = null;
  for (const tab of tabs) {
    if (tab.getAttribute("data-tab") === route) {
      tab.setAttribute("aria-current", "page");
      activeTab = tab;
    } else {
      tab.removeAttribute("aria-current");
    }
  }
  updateTabIndicator(activeTab, !firstRender && activeTab === clickedTab);
  clickedTab = null;
  if (!firstRender) document.getElementById(`title-${route}`)?.focus();
  firstRender = false;
  // 홈이 넘긴 질문은 URL에 넣지 않고 메모리로만 받는다. 같은 질문 객체는 chat이 한 번만 실행한다.
  if (route === "aio" && state) chat.ask(state);
  else if (route === "aio") chat.refresh();
  // 아이오에서 바꾼 모드를 홈 표시에도 반영한다.
  if (route === "home") syncHomeMode({ home, storage: prefs });
  if (route === "graduation") {
    demoLogin.refresh();
    if (state?.section === "recommendations") {
      const title = document.querySelector('[data-grad-section="recommendations"] h2')
        ?? document.getElementById("title-graduation");
      title?.setAttribute("tabindex", "-1");
      title?.focus();
    }
  }
  if (route === "calendar") calendar.refresh();
}

const router = createRouter({ win: window, onRoute: showView });

home = mountHome({
  root: homeRoot,
  doc: document,
  storage: prefs,
  loadCampusGuide: () => api.campusGuide(),
  navigate: (route, state) => router.navigate(route, state),
});

router.start();

function registerServiceWorker() {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // 등록 실패해도 앱은 온라인으로 계속 동작한다.
  });
}

if ("serviceWorker" in navigator) {
  // 위의 await 동안 load가 이미 지났을 수 있다. 그때는 바로 등록한다.
  if (document.readyState === "complete") registerServiceWorker();
  else window.addEventListener("load", registerServiceWorker, { once: true });
}
