export const RELEASE_URL = "https://api.github.com/repos/kumoh-aio/aio-app/releases/latest";
export const SKIPPED_VERSION_KEY = "aio.skippedReleaseVersion";

const RELEASE_DOWNLOAD = "https://github.com/kumoh-aio/aio-app/releases/download";
const APK_NAME = "aio-release.apk";
const REQUEST_TIMEOUT_MS = 5000;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function versionParts(version) {
  if (typeof version !== "string") return null;
  const normalized = version.endsWith("-debug") ? version.slice(0, -6) : version;
  return VERSION_PATTERN.exec(normalized)?.slice(1) ?? null;
}

export function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (!leftParts || !rightParts) return null;

  for (let index = 0; index < leftParts.length; index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

export function parseRelease(payload) {
  const tag = payload?.tag_name;
  if (typeof tag !== "string" || !tag.startsWith("v") || !Array.isArray(payload.assets)) {
    return null;
  }
  const version = tag.slice(1);
  if (!VERSION_PATTERN.test(version)) return null;

  const url = `${RELEASE_DOWNLOAD}/${tag}/${APK_NAME}`;
  const hasApk = payload.assets.some((asset) =>
    asset?.name === APK_NAME && asset.browser_download_url === url
  );
  return hasApk ? { version, url } : null;
}

async function fetchRelease(fetchReleaseJson, startTimer, stopTimer) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = startTimer(() => {
      controller.abort();
      resolve(null);
    }, REQUEST_TIMEOUT_MS);
  });

  async function readRelease() {
    const response = await fetchReleaseJson(RELEASE_URL, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return parseRelease(await response.json());
  }

  try {
    return await Promise.race([timeout, readRelease()]);
  } finally {
    stopTimer(timer);
  }
}

function makeElement(document, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function showReleaseDialog(document, release, isDebug, remember, openDownload) {
  const previousFocus = document.activeElement;
  const dialog = makeElement(document, "dialog", "release-update");
  const title = makeElement(document, "h2", "", "새 버전이 있어요");
  const description = makeElement(document, "p", "", `새 버전 ${release.version}을 받을 수 있어요.`);
  const actions = makeElement(document, "div", "release-update-actions");
  const later = makeElement(document, "button", "release-update-later", "나중에");
  const download = makeElement(document, "button", "release-update-download", "받기");
  title.id = "release-update-title";
  description.id = "release-update-description";
  later.type = "button";
  later.setAttribute("autofocus", "");
  download.type = "button";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-labelledby", title.id);
  dialog.append(title, description);

  const descriptions = [description.id];
  if (isDebug) {
    const debug = makeElement(
      document,
      "p",
      "release-update-debug",
      "테스트용 앱은 지운 뒤 설치해야 해요. 앱을 지우면 저장된 대화 기록도 지워져요."
    );
    debug.id = "release-update-debug";
    descriptions.push(debug.id);
    dialog.append(debug);
  }
  dialog.setAttribute("aria-describedby", descriptions.join(" "));
  actions.append(later, download);
  dialog.append(actions);

  let closed = false;
  function restoreFocus() {
    if (closed) return;
    closed = true;
    dialog.remove();
    previousFocus?.focus();
  }

  function close() {
    dialog.close();
    restoreFocus();
  }

  function skip() {
    remember(release.version);
    close();
  }

  later.addEventListener("click", skip);
  download.addEventListener("click", async () => {
    close();
    try {
      await openDownload(release.url);
    } catch {
      // 기본 처리 앱을 열 수 없더라도 앱은 그대로 쓸 수 있다.
    }
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    skip();
  });
  dialog.addEventListener("close", restoreFocus);
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const current = document.activeElement;
    const target = current === later || (current !== download && event.shiftKey)
      ? download
      : later;
    target.focus();
  });

  document.body.append(dialog);
  try {
    dialog.showModal();
    later.focus();
  } catch {
    restoreFocus();
  }
}

export async function initReleaseUpdate(options = {}) {
  try {
    const capacitor = options.capacitor ?? globalThis.Capacitor;
    if (!capacitor?.isNativePlatform?.() || capacitor.getPlatform?.() !== "android") return;

    const app = capacitor.Plugins?.App ?? capacitor.registerPlugin?.("App");
    const installed = (await app?.getInfo())?.version;
    if (!versionParts(installed)) return;

    const release = await fetchRelease(
      options.fetch ?? ((...args) => globalThis.fetch(...args)),
      options.setTimeout ?? globalThis.setTimeout,
      options.clearTimeout ?? globalThis.clearTimeout
    );
    if (!release || compareVersions(release.version, installed) !== 1) return;

    let storage;
    try {
      storage = options.storage ?? globalThis.localStorage;
      const skipped = storage?.getItem(SKIPPED_VERSION_KEY);
      if (skipped && VERSION_PATTERN.test(skipped)) {
        if (compareVersions(release.version, skipped) !== 1) return;
      }
    } catch {
      // 저장소를 읽지 못해도 업데이트를 안내한다.
    }

    function remember(version) {
      try {
        storage?.setItem(SKIPPED_VERSION_KEY, version);
      } catch {
        // 저장소를 쓸 수 없어도 안내는 닫는다.
      }
    }

    showReleaseDialog(
      options.document ?? globalThis.document,
      release,
      installed.endsWith("-debug"),
      remember,
      options.openDownload ?? ((url) => globalThis.location.assign(url))
    );
  } catch {
    // 릴리스 확인 실패는 앱 시작을 막지 않는다.
  }
}
