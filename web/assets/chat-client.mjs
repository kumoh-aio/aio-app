import { secureUrl } from "./api.mjs";
import { API_BASE } from "./config.mjs";

const text = (value) => typeof value === "string" ? value : "";
const chatEvents = new Set(["meta", "thinking", "answer", "notice", "done", "error"]);

function normalizeCitations(citations) {
  if (!Array.isArray(citations)) return [];
  return citations.filter((item) => item && typeof item === "object").map((item) => ({
    document: text(item.document),
    article: text(item.article_path),
    snippet: text(item.snippet),
    effectiveDate: text(item.effective_date),
    url: secureUrl(item.source_url) ? item.source_url : null,
  }));
}

function finish(state, data) {
  state.status = "done";
  state.guided = data.guided === true;
  state.latencyMs = Number.isFinite(data.latency_ms?.total) ? data.latency_ms.total : null;
  if (typeof data.answered === "boolean") state.answered = data.answered;
  if (state.guided || state.answered === false) state.citations = [];
}

function applyEvent(state, event, payload) {
  if (!chatEvents.has(event)) return false;
  const data = JSON.parse(payload);
  switch (event) {
    case "meta":
      state.sessionId = text(data.session_id) || state.sessionId;
      state.answered = typeof data.answered === "boolean" ? data.answered : null;
      state.citations = state.answered === false ? [] : normalizeCitations(data.citations);
      break;
    case "thinking":
      state.thinking += text(data.text);
      state.thinkingLabel = text(data.label) || state.thinkingLabel;
      break;
    case "answer":
      state.answer = (data.replace === true ? "" : state.answer) + text(data.text);
      break;
    case "notice":
      state.notice = text(data.text);
      break;
    case "done":
      finish(state, data);
      break;
    case "error":
      throw new Error("스트림 응답이 중단됐어요.");
  }
  return true;
}

async function readStream(body, signal, state, publish) {
  const reader = body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const decoder = new TextDecoder();
  let pending = "";
  let event = "";
  let data = [];
  let trailingCr = false;

  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      const decoded = decoder.decode(chunk.value, { stream: !chunk.done });
      // 앞 청크 끝의 CR을 이미 줄바꿈으로 처리했다면 짝이 되는 LF를 건너뛴다.
      const normalized = (trailingCr ? decoded.replace(/^\n/, "") : decoded)
        .replace(/\r\n?/g, "\n");
      if (decoded) trailingCr = decoded.endsWith("\r");
      const lines = (pending + normalized).split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (line === "") {
          if (data.length && applyEvent(state, event, data.join("\n"))) {
            if (state.status === "done") return;
            publish(state);
            signal.throwIfAborted();
          }
          event = "";
          data = [];
        } else if (line.startsWith("event:")) {
          event = line.slice(6).replace(/^ /, "");
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (chunk.done) throw new Error("완료 이벤트를 받지 못했어요.");
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

async function withDeadline(signal, timeoutMs, run) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("응답 제한 시간이 지났어요.")), timeoutMs);
  let rejectOnAbort;
  const aborted = new Promise((_, reject) => {
    rejectOnAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", rejectOnAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, run(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectOnAbort);
  }
}

export function createChatClient({
  base = API_BASE,
  fetchImpl = globalThis.fetch,
  timeoutMs = 100000,
} = {}) {
  const root = `${base.replace(/\/+$/, "")}/api/v1`;
  return {
    async send({ message, mode = "fast", lang = "ko", sessionId = null, signal, onUpdate }) {
      const body = JSON.stringify({
        session_id: sessionId, message, use_academic_data: false, mode, lang,
      });
      const initial = {
        status: "streaming", answer: "", thinking: "", thinkingLabel: "",
        citations: [], notice: "", answered: null, guided: false,
        sessionId, latencyMs: null, error: null,
      };
      const publish = (state) => {
        onUpdate?.({ ...state, citations: state.citations.map((item) => ({ ...item })) });
        return state;
      };
      const post = async (path, accept, requestSignal) => {
        const response = await fetchImpl(`${root}${path}`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: accept },
          body, signal: requestSignal, credentials: "omit", cache: "no-store",
        });
        if (requestSignal.aborted || response.status !== 200) {
          void response.body?.cancel().catch(() => {});
          requestSignal.throwIfAborted();
          throw new Error(`서버 요청 실패 (${response.status})`);
        }
        return response;
      };
      const failed = () => publish({
        ...initial, status: "failed",
        error: signal?.aborted ? "요청을 취소했어요." : "답변을 받지 못했어요.",
      });

      if (signal?.aborted) return failed();
      const streaming = { ...initial };
      publish(streaming);
      try {
        await withDeadline(signal, timeoutMs, async (requestSignal) => {
          const response = await post("/chat/stream", "text/event-stream", requestSignal);
          requestSignal.throwIfAborted();
          await readStream(response.body, requestSignal, streaming, publish);
        });
      } catch {
        if (signal?.aborted) return failed();
        const fallback = { ...initial, status: "fallback" };
        publish(fallback);
        try {
          const data = await withDeadline(signal, timeoutMs, async (requestSignal) => {
            const response = await post("/chat", "application/json", requestSignal);
            return response.json();
          });
          if (signal?.aborted || typeof data?.answer !== "string") return failed();
          fallback.answer = data.answer;
          fallback.notice = text(data.notice);
          fallback.sessionId = text(data.session_id) || sessionId;
          fallback.citations = normalizeCitations(data.citations);
          finish(fallback, data);
        } catch {
          return failed();
        }
        return publish(fallback);
      }
      return signal?.aborted ? failed() : publish(streaming);
    },
  };
}
