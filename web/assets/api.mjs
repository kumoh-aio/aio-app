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

const PNG_MAX_DIMENSION = 0x7fffffff;
// 색 형식별로 허용하는 비트 깊이(PNG 명세 11.2.2 IHDR 표)
const PNG_BIT_DEPTHS = Object.freeze({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] });
// 디코더가 알아야 하는 필수 청크. 이 밖의 필수(첫 글자 대문자) 청크가 나오면 디코더가 실패하므로 거부한다.
const PNG_CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);

let crcTable = null;
function crc32(bytes, start, end) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const isLetter = (byte) => (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
const isUpper = (byte) => byte >= 0x41 && byte <= 0x5a;

// IHDR 13바이트: 가로·세로 1~2^31-1, 색 형식에 맞는 비트 깊이, 압축 0, 필터 0, 인터레이스 0·1.
function readHeader(view, at) {
  const width = view.getUint32(at);
  const height = view.getUint32(at + 4);
  const depth = view.getUint8(at + 8);
  const color = view.getUint8(at + 9);
  if (width === 0 || height === 0 || width > PNG_MAX_DIMENSION || height > PNG_MAX_DIMENSION) return null;
  if (!PNG_BIT_DEPTHS[color]?.includes(depth)) return null;
  if (view.getUint8(at + 10) !== 0 || view.getUint8(at + 11) !== 0 || view.getUint8(at + 12) > 1) return null;
  return { depth, color };
}

/**
 * 서버에 보내기 전에 PNG 구조를 확인한다. 픽셀 압축을 풀지는 않는다.
 * - 서명 8바이트, 청크마다 길이(2^31-1 이하)·영문자 형식·CRC 일치
 * - 첫 청크 IHDR(readHeader 규칙), IHDR은 한 번만
 * - PLTE는 IDAT 앞에 한 번까지, 길이는 3의 배수 3~768이고 색 형식 3은 필수, 0·4는 금지
 * - IDAT는 하나 이상이며 이어서 나오고, 합친 데이터의 앞 2바이트가 사전 없는 zlib deflate 머리
 * - 모르는 필수 청크 금지, IEND(길이 0)가 파일 끝과 정확히 맞아야 한다
 */
export function isPngStructure(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < PNG_SIGNATURE.length) return false;
  if (PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = PNG_SIGNATURE.length;
  let header = null;
  let palette = false;
  let dataState = "before"; // before → inside → after
  const zlibHead = [];
  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at);
    if (length > PNG_MAX_DIMENSION) return false;
    const typeBytes = bytes.subarray(at + 4, at + 8);
    if (!typeBytes.every(isLetter) || !isUpper(typeBytes[2])) return false;
    const type = String.fromCharCode(...typeBytes);
    const dataAt = at + 8;
    const end = dataAt + length + 4;
    if (end > bytes.length) return false;
    if (crc32(bytes, at + 4, dataAt + length) !== view.getUint32(dataAt + length)) return false;
    if (!header && type !== "IHDR") return false;
    if (isUpper(typeBytes[0]) && !PNG_CRITICAL.has(type)) return false;
    if (dataState === "inside" && type !== "IDAT") dataState = "after";

    if (type === "IHDR") {
      if (header || length !== 13) return false;
      header = readHeader(view, dataAt);
      if (!header) return false;
    } else if (type === "PLTE") {
      if (palette || dataState !== "before" || header.color === 0 || header.color === 4) return false;
      if (length % 3 !== 0 || length < 3 || length > 768) return false;
      if (header.color === 3 && length / 3 > 2 ** header.depth) return false;
      palette = true;
    } else if (type === "IDAT") {
      if (dataState === "after") return false;
      if (header.color === 3 && !palette) return false;
      dataState = "inside";
      for (let i = 0; i < length && zlibHead.length < 2; i += 1) zlibHead.push(bytes[dataAt + i]);
    } else if (type === "IEND") {
      if (length !== 0 || dataState === "before" || end !== bytes.length) return false;
      const [cmf, flg] = zlibHead;
      if (zlibHead.length < 2 || (cmf & 0x0f) !== 8 || cmf >> 4 > 7) return false;
      return ((cmf << 8) | flg) % 31 === 0 && (flg & 0x20) === 0;
    }
    at = end;
  }
  return false; // IEND 없이 끝났거나 마지막 청크가 잘렸다
}

// 형식이 맞지 않으면 415, 크면 413. 크기를 먼저 보고 2,000,000바이트 이하일 때만 내용을 읽는다.
async function checkPng(image) {
  if (typeof Blob === "undefined" || !(image instanceof Blob) || image.type !== "image/png") throw statusError(415);
  if (image.size > HANDWRITING_MAX_BYTES) throw statusError(413);
  if (!isPngStructure(new Uint8Array(await image.arrayBuffer()))) throw statusError(415);
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
