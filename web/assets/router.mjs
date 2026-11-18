// 해시 탭 라우터. DOM에 기대지 않고 주입받은 window 모양 객체만 쓴다.
// 질문 같은 상태는 URL에 넣지 않고 메모리로 한 번만 넘긴다.

export const ROUTES = Object.freeze(["home", "aio", "graduation", "calendar", "more"]);
export const DEFAULT_ROUTE = "home";

const HASH_PATTERN = /^#\/([a-z]+)\/?$/;

/** "#/aio" → "aio". 모르는 해시나 빈 해시는 null. */
export function parseHash(hash) {
  const match = HASH_PATTERN.exec(String(hash ?? ""));
  if (match && ROUTES.includes(match[1])) return match[1];
  return null;
}

/** "aio" → "#/aio". 모르는 이름이면 예외를 던진다. */
export function hashFor(route) {
  if (!ROUTES.includes(route)) throw new RangeError(`unknown route: ${route}`);
  return `#/${route}`;
}

/**
 * @param {{ win: { location: { hash: string, replace(url: string): void },
 *                  addEventListener(type: string, fn: Function): void,
 *                  removeEventListener?(type: string, fn: Function): void },
 *           onRoute: (change: { route: string, state: unknown }) => void }} options
 */
export function createRouter({ win, onRoute }) {
  if (!win || typeof onRoute !== "function") {
    throw new TypeError("createRouter needs win and onRoute");
  }
  let current = null;
  let pending = null; // { route, state } — navigate()가 남긴 일회용 상태

  function resolve() {
    const route = parseHash(win.location.hash);
    if (!route) {
      // replace라서 잘못된 해시가 방문 기록에 남지 않는다. 뒤로가기가 제자리를 맴돌지 않음.
      pending = null;
      win.location.replace(hashFor(DEFAULT_ROUTE));
      show(DEFAULT_ROUTE, null);
      return;
    }
    const state = pending && pending.route === route ? pending.state : null;
    pending = null;
    show(route, state);
  }

  function show(route, state) {
    if (route === current && state == null) return; // 같은 탭 중복 렌더 막기
    current = route;
    onRoute({ route, state: state ?? null });
  }

  function navigate(route, state = null) {
    const hash = hashFor(route);
    pending = state == null ? null : { route, state };
    if (parseHash(win.location.hash) === route) {
      resolve(); // 해시가 같으면 hashchange가 오지 않으므로 직접 처리
    } else {
      win.location.hash = hash;
    }
  }

  return {
    start() {
      win.addEventListener("hashchange", resolve);
      resolve();
    },
    stop() {
      win.removeEventListener?.("hashchange", resolve);
    },
    navigate,
    get current() {
      return current;
    },
  };
}
