// 부팅과 서비스 워커 등록만 맡는다. 테스트에서는 불러오지 않는다.
import { API_BASE } from "./config.mjs";
import { createApi } from "./api.mjs";
import { createRouter } from "./router.mjs";
import { mountHome } from "./home.mjs";

const api = createApi({ base: API_BASE, fetchImpl: globalThis.fetch.bind(globalThis) });

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // 저장소 접근이 막힌 환경
  }
}

// 다음 이슈(채팅 화면)가 받아 갈 질문. URL에 넣지 않고 메모리에만 둔다.
let pendingAsk = null;
let firstRender = true;

function showView({ route, state }) {
  if (route === "aio" && state) pendingAsk = state;
  for (const view of document.querySelectorAll("[data-view]")) {
    view.hidden = view.getAttribute("data-view") !== route;
  }
  for (const tab of document.querySelectorAll("[data-tab]")) {
    if (tab.getAttribute("data-tab") === route) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  if (!firstRender) document.getElementById(`title-${route}`)?.focus();
  firstRender = false;
}

const router = createRouter({ win: window, onRoute: showView });

mountHome({
  root: document.getElementById("home-root"),
  doc: document,
  storage: safeStorage(),
  loadCampusGuide: () => api.campusGuide(),
  navigate: (route, state) => router.navigate(route, state),
});

router.start();

export function takePendingAsk() {
  const ask = pendingAsk;
  pendingAsk = null;
  return ask;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // 등록 실패해도 앱은 온라인으로 계속 동작한다.
    });
  });
}
