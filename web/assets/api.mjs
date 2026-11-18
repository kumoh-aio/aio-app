import { API_BASE } from "./config.mjs";

// Render 기동 대기를 포함해 본문을 읽을 때까지 요청별 제한 시간을 적용한다.
export async function requestJson(url, {
  fetchImpl = globalThis.fetch,
  method = "GET",
  body,
  timeoutMs = 90000,
} = {}) {
  const attempts = method === "GET" ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(url, {
          method, signal: controller.signal, credentials: "omit", cache: "no-store",
          ...(body === undefined ? {} : {
            headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          }),
        });
      } catch (error) {
        if (attempt + 1 < attempts && !controller.signal.aborted) continue;
        throw error;
      }
      if (!response.ok) {
        if (response.status >= 500 && response.status <= 599 && attempt + 1 < attempts) {
          await response.body?.cancel();
          continue;
        }
        const error = new Error(`서버 요청 실패 (${response.status})`);
        error.status = response.status;
        throw error;
      }
      try {
        return await response.json();
      } catch (error) {
        if (error instanceof TypeError && attempt + 1 < attempts && !controller.signal.aborted) continue;
        throw error;
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

export function secureUrl(value) {
  if (typeof value !== "string" || /\s/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export const HANDWRITING_MAX_BYTES = 2000000;
export const HANDWRITING_LANGS = Object.freeze(["ko", "en", "zh"]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function statusError(status) {
  // 서버 본문 문구는 쓰지 않는다. 화면은 status로 고정 문구를 고른다.
  const error = new Error(`손글씨 인식 실패 (${status})`);
  error.status = status;
  return error;
}

// 형식은 MIME 형식과 PNG 서명 8바이트를 함께 본다. 맞지 않으면 415, 크면 413.
async function checkPng(image) {
  if (typeof Blob === "undefined" || !(image instanceof Blob) || image.type !== "image/png") throw statusError(415);
  if (image.size > HANDWRITING_MAX_BYTES) throw statusError(413);
  if (image.size < PNG_SIGNATURE.length) throw statusError(415);
  const head = new Uint8Array(await image.slice(0, PNG_SIGNATURE.length).arrayBuffer());
  if (PNG_SIGNATURE.some((byte, index) => head[index] !== byte)) throw statusError(415);
}

/**
 * 손글씨 PNG를 서버에 보내 읽은 글자를 받는다. POST라 자동 재시도는 하지 않는다.
 * 제한 시간(기본 90초)과 호출자의 signal 가운데 먼저 끝나는 쪽이 요청을 중단한다.
 */
export async function requestHandwriting(url, { image, lang, signal, fetchImpl = globalThis.fetch, timeoutMs = 90000 } = {}) {
  await checkPng(image);
  if (signal?.aborted) throw signal.reason;
  const form = new FormData();
  form.append("image", image, "handwriting.png");
  if (HANDWRITING_LANGS.includes(lang)) form.append("lang", lang);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("손글씨 인식 시간 초과", "TimeoutError")), timeoutMs);
  const relay = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", relay, { once: true });
  try {
    // Content-Type은 지정하지 않는다. 브라우저가 multipart 경계를 붙인다.
    const response = await fetchImpl(url, {
      method: "POST", body: form, signal: controller.signal, credentials: "omit", cache: "no-store",
    });
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* 본문은 읽지 않는다 */ }
      throw statusError(response.status);
    }
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason ?? error;
      throw statusError(422);
    }
    const text = typeof data?.text === "string" ? data.text.trim() : "";
    if (!text) throw statusError(422);
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", relay);
  }
}

export function createApi({ base = API_BASE, fetchImpl = globalThis.fetch, handwritingTimeoutMs = 90000 } = {}) {
  const root = `${base.replace(/\/+$/, "")}/api/v1`;
  const get = (path) => requestJson(`${root}${path}`, { fetchImpl });
  return {
    handwriting: ({ image, lang, signal } = {}) => requestHandwriting(`${root}/handwriting`, {
      image, lang, signal, fetchImpl, timeoutMs: handwritingTimeoutMs,
    }),
    demoStudents: () => get("/demo-students"),
    demoLogin(id) {
      const accounts = {
        "demo-d02": { student_number: "20990002", password: "demo-d02-pass" },
        "demo-d03": { student_number: "20990003", password: "demo-d03-pass" },
        "demo-d04": { student_number: "20990004", password: "demo-d04-pass" },
      };
      if (!Object.hasOwn(accounts, id)) {
        const error = new Error("시연 계정을 선택해 주세요.");
        error.status = 401;
        return Promise.reject(error);
      }
      return requestJson(`${root}/demo-login`, { fetchImpl, method: "POST", body: accounts[id] });
    },
    graduationDemo: (id) => get(`/graduation-demo?student_id=${encodeURIComponent(id)}`),
    health: () => get("/health"),
    async campusGuide() {
      const data = await get("/campus-guide");
      if (!Array.isArray(data?.places)) throw new Error("캠퍼스 안내 형식이 올바르지 않습니다.");
      return data.places.flatMap((place) => {
        if (typeof place?.name !== "string" || !place.name.trim()) return [];
        if (!Array.isArray(place.sources)) return [];
        return place.sources.filter((source) => secureUrl(source?.url)).map((source) => ({
          title: place.name,
          url: source.url,
          note: typeof place.purpose === "string" ? place.purpose : "",
        }));
      });
    },
  };
}
