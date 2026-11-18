import { secureUrl } from "./api.mjs";

const HISTORY_KEY = "aio.chat.history.v2";
const LEGACY_KEY = "aio.chat.history.v1";

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

// A snapshot is complete by definition; explicit transient states are never persisted.
function normalizeSnapshot(value) {
  if (!value || typeof value.message !== "string" || !value.message.trim()
      || (value.status !== undefined && value.status !== "done")) return null;
  const guided = value.guided === true;
  const answered = typeof value.answered === "boolean" ? value.answered : null;
  return {
    message: value.message,
    mode: ["fast", "deep"].includes(value.mode) ? value.mode : "fast",
    lang: ["ko", "en", "zh"].includes(value.lang) ? value.lang : "ko",
    answer: text(value.answer),
    thinkingLabel: text(value.thinkingLabel),
    citations: guided || answered === false ? [] : normalizeCitations(value.citations),
    notice: text(value.notice),
    answered,
    guided,
    sessionId: sessionId(value.sessionId),
    latencyMs: Number.isFinite(value.latencyMs) ? value.latencyMs : null,
  };
}

function normalizeHistory(value) {
  return {
    sessionId: sessionId(value?.sessionId),
    turns: Array.isArray(value?.turns) ? value.turns.flatMap((turn) => {
      if (!Array.isArray(turn?.versions)) return [];
      const selected = Number.isInteger(turn.selectedVersion) ? turn.selectedVersion : 0;
      const versions = [];
      let selectedVersion = 0;
      turn.versions.forEach((version, index) => {
        const snapshot = normalizeSnapshot(version);
        if (!snapshot) return;
        if (index <= selected) selectedVersion = versions.length;
        versions.push(snapshot);
      });
      return versions.length ? [{ selectedVersion, versions }] : [];
    }) : [],
  };
}

function migrate(value) {
  return normalizeHistory({
    sessionId: value?.sessionId,
    turns: Array.isArray(value?.turns) ? value.turns
      .filter((turn) => turn?.status === "done")
      .map((turn) => ({ selectedVersion: 0, versions: [turn] })) : [],
  });
}

export function createChatHistory({ storage } = {}) {
  const getStorage = () => storage === undefined ? globalThis.localStorage : storage;

  function save(state) {
    const stored = normalizeHistory(state);
    try {
      const target = getStorage();
      while (true) {
        try {
          target.setItem(HISTORY_KEY, JSON.stringify(stored));
          break;
        } catch (error) {
          if (error?.name !== "QuotaExceededError" || stored.turns.length === 0) return false;
          stored.turns.shift();
        }
      }
      // Cleanup failure must not undo a successful v2 write.
      try { target.removeItem(LEGACY_KEY); } catch { /* v2 remains authoritative */ }
      return true;
    } catch {
      return false;
    }
  }

  return {
    load() {
      try {
        const target = getStorage();
        const current = target.getItem(HISTORY_KEY);
        if (current !== null) return normalizeHistory(JSON.parse(current));
        const legacy = target.getItem(LEGACY_KEY);
        if (legacy === null) return normalizeHistory(null);
        const migrated = migrate(JSON.parse(legacy));
        save(migrated);
        return migrated;
      } catch {
        return normalizeHistory(null);
      }
    },
    save,
    clear() {
      let cleared = true;
      for (const key of [HISTORY_KEY, LEGACY_KEY]) {
        try { getStorage().removeItem(key); } catch { cleared = false; }
      }
      return cleared;
    },
  };
}
