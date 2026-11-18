import { API_BASE } from "./config.mjs";

// Render 기동 대기를 포함해 본문을 읽을 때까지 요청별 제한 시간을 적용한다.
export async function requestJson(url, {
  fetchImpl = globalThis.fetch,
  method = "GET",
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
        throw new Error(`서버 요청 실패 (${response.status})`);
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

function secureUrl(value) {
  if (typeof value !== "string" || /\s/.test(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function createApi({ base = API_BASE, fetchImpl = globalThis.fetch } = {}) {
  const root = `${base.replace(/\/+$/, "")}/api/v1`;
  const get = (path) => requestJson(`${root}${path}`, { fetchImpl });
  return {
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
