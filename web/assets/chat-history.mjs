import { secureUrl } from "./api.mjs";

const HISTORY_KEY = "aio.chat.history.v1";

function text(value) {
  return typeof value === "string" ? value : "";
}

function sessionId(value) {
  return text(value) || null;
}

function normalizeCitations(citations) {
  if (!Array.isArray(citations)) return [];
  return citations.filter((citation) => citation && typeof citation === "object").map((citation) => ({
    document: text(citation.document),
    article: text(citation.article),
    snippet: text(citation.snippet),
    effectiveDate: text(citation.effectiveDate),
    url: secureUrl(citation.url) ? citation.url : null,
  }));
}

function normalizeHistory(value) {
  return {
    sessionId: sessionId(value?.sessionId),
    turns: Array.isArray(value?.turns) ? value.turns.flatMap((turn) => {
      if (turn?.status !== "done" || typeof turn.message !== "string") return [];

      const guided = turn.guided === true;
      const answered = typeof turn.answered === "boolean" ? turn.answered : null;
      return [{
        message: turn.message,
        status: "done",
        answer: text(turn.answer),
        thinkingLabel: text(turn.thinkingLabel),
        citations: guided || answered === false ? [] : normalizeCitations(turn.citations),
        notice: text(turn.notice),
        answered,
        guided,
        sessionId: sessionId(turn.sessionId),
        latencyMs: Number.isFinite(turn.latencyMs) ? turn.latencyMs : null,
        error: null,
      }];
    }) : [],
  };
}

export function createChatHistory({ storage } = {}) {
  // Access to localStorage itself can throw, as can any operation on it.
  const getStorage = () => storage === undefined ? globalThis.localStorage : storage;

  return {
    load() {
      try {
        const stored = normalizeHistory(JSON.parse(getStorage().getItem(HISTORY_KEY)));
        return {
          ...stored,
          turns: stored.turns.map((turn) => ({ ...turn, thinking: "" })),
        };
      } catch {
        return normalizeHistory(null);
      }
    },
    save(state) {
      const stored = normalizeHistory(state);
      try {
        const target = getStorage();
        while (true) {
          try {
            target.setItem(HISTORY_KEY, JSON.stringify(stored));
            return true;
          } catch (error) {
            if (error?.name !== "QuotaExceededError" || stored.turns.length === 0) return false;
            stored.turns.shift();
          }
        }
      } catch {
        return false;
      }
    },
    clear() {
      try {
        getStorage().removeItem(HISTORY_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}
