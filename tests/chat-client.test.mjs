import test from "node:test";
import assert from "node:assert/strict";
import { createChatClient } from "../web/assets/chat-client.mjs";

const base = "https://example.invalid";
const streamUrl = `${base}/api/v1/chat/stream`;
const fallbackUrl = `${base}/api/v1/chat`;
const message = "가상 질문";
const citation = {
  document: "가상 문서",
  article_path: "가상 조문",
  snippet: "가상 인용",
  effective_date: "2099-01-01",
  source_url: `${base}/fictional`,
};
const fallback = { answer: "가상 대체 답변", answered: true, session_id: "fictional-fallback" };

function event(name, data) {
  return `event: ${name}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
}

function streamResponse(source, chunkEnds = []) {
  const bytes = new TextEncoder().encode(source);
  return new Response(new ReadableStream({
    start(controller) {
      let start = 0;
      for (const end of [...chunkEnds, bytes.length]) {
        controller.enqueue(bytes.subarray(start, end));
        start = end;
      }
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

test("decodes split UTF-8, CRLF and SSE frames, and applies replacement and notice", async () => {
  const meta = event("meta", {
    answered: true,
    citations: [citation, { ...citation, source_url: "http://example.invalid/fictional" }],
    session_id: "fictional-stream",
  });
  const thinking = event("thinking", { text: "가상 생각", label: "Fictional label" });
  const source = meta + thinking
    + event("answer", { text: "가상 기존" })
    + "event: fictional\r\ndata: non-JSON payload\r\n\r\n"
    + event("answer", { text: "가상 교체", replace: true })
    + event("answer", { text: " 답변" })
    + event("notice", { text: "가상 안내" })
    + event("done", { latency_ms: { retrieval: 10, generation: 20, total: 30 } });
  // Split every byte of the first two events, then deliver the rest in one chunk.
  const splitCount = new TextEncoder().encode(meta + thinking).length;
  const chunkEnds = Array.from({ length: splitCount }, (_, index) => index + 1);
  const calls = [];
  const updates = [];
  const client = createChatClient({ base: `${base}/`, fetchImpl: async (url) => {
    calls.push(url);
    return streamResponse(source, chunkEnds);
  } });
  const result = await client.send({ message, mode: "deep", lang: "en", onUpdate: (state) => updates.push(state) });
  const expectedCitation = {
    document: "가상 문서", article: "가상 조문", snippet: "가상 인용",
    effectiveDate: "2099-01-01", url: citation.source_url,
  };
  assert.deepEqual(calls, [streamUrl]);
  assert.ok(updates.some(({ status, answer }) => status === "streaming" && answer === "가상 기존"));
  assert.deepEqual(updates.at(-1), result);
  assert.equal(result.status, "done");
  assert.equal(result.answer, "가상 교체 답변");
  assert.equal(result.thinking, "가상 생각");
  assert.equal(result.thinkingLabel, "Fictional label");
  assert.equal(result.notice, "가상 안내");
  assert.equal(result.sessionId, "fictional-stream");
  assert.equal(result.latencyMs, 30);
  assert.equal(result.answered, true);
  assert.deepEqual(result.citations, [expectedCitation, { ...expectedCitation, url: null }]);
});

test("CR-only event framing accepts a trailing delimiter at EOF", async () => {
  const source = (event("answer", { text: "가상 답변" }) + event("done", { answered: true }))
    .replaceAll("\r\n", "\r");
  const calls = [];
  const client = createChatClient({ base, fetchImpl: async (url) => {
    calls.push(url);
    return streamResponse(source);
  } });
  const result = await client.send({ message });
  assert.deepEqual(calls, [streamUrl]);
  assert.equal(result.status, "done");
  assert.equal(result.answer, "가상 답변");
});

for (const [label, done] of [
  ["unanswered", { answered: false }],
  ["guided", { answered: false, guided: true }],
]) {
  test(`${label} completion clears preliminary citations`, async () => {
    const calls = [];
    const client = createChatClient({ base, fetchImpl: async (url) => {
      calls.push(url);
      return streamResponse(event("meta", { answered: true, citations: [citation] })
        + event("answer", { text: "가상 안내 답변" })
        + event("done", done));
    } });
    const result = await client.send({ message });
    assert.deepEqual(calls, [streamUrl]);
    assert.equal(result.status, "done");
    assert.equal(result.answered, false);
    assert.equal(result.guided, done.guided === true);
    assert.deepEqual(result.citations, []);
  });
}

for (const [label, failStream] of [
  ["missing done", () => streamResponse(event("answer", { text: "가상 미완성" }))],
  ["error event", () => streamResponse(event("error", { text: "가상 오류" }))],
  ["non-200", () => new Response(null, { status: 503 })],
  ["non-200 successful HTTP", () => new Response(null, { status: 201 })],
]) {
  test(`${label} triggers exactly one fallback`, async () => {
    const calls = [];
    const updates = [];
    const client = createChatClient({ base, fetchImpl: async (url) => {
      calls.push(url);
      return url === streamUrl ? failStream() : Response.json(fallback);
    } });
    const result = await client.send({ message, onUpdate: (state) => updates.push(state) });
    assert.deepEqual(calls, [streamUrl, fallbackUrl]);
    assert.ok(updates.some(({ status }) => status === "fallback"));
    assert.equal(result.status, "done");
    assert.equal(result.answer, fallback.answer);
    assert.equal(result.sessionId, fallback.session_id);
  });
}

test("a failed fallback ends the request", async () => {
  const calls = [];
  const client = createChatClient({ base, fetchImpl: async (url) => {
    calls.push(url);
    return new Response(null, { status: 503 });
  } });
  const result = await client.send({ message });
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, [streamUrl, fallbackUrl]);
});

for (const mode of ["fast", "deep"]) {
  for (const lang of ["ko", "en", "zh"]) {
    test(`${mode}/${lang} is sent in both request bodies`, async () => {
      const calls = [];
      const client = createChatClient({ base, fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return url === streamUrl ? new Response(null, { status: 503 }) : Response.json(fallback);
      } });
      await client.send({ message, mode, lang, sessionId: "fictional-input" });
      assert.deepEqual(calls.map(({ url }) => url), [streamUrl, fallbackUrl]);
      for (const { options } of calls) {
        assert.equal(options.method, "POST");
        assert.equal(options.credentials, "omit");
        assert.equal(options.cache, "no-store");
        assert.deepEqual(JSON.parse(options.body), {
          session_id: "fictional-input", message, use_academic_data: false, mode, lang,
        });
      }
    });
  }
}

test("timeout while reading triggers one fallback", { timeout: 1000 }, async () => {
  const calls = [];
  const client = createChatClient({ base, timeoutMs: 10, fetchImpl: async (url) => {
    calls.push(url);
    if (url === streamUrl) {
      return new Response(new ReadableStream(), {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return Response.json(fallback);
  } });
  const result = await client.send({ message });
  assert.deepEqual(calls, [streamUrl, fallbackUrl]);
  assert.equal(result.status, "done");
});

test("caller cancellation stops a pending stream without fallback", { timeout: 1000 }, async () => {
  const calls = [];
  const controller = new AbortController();
  let startReading;
  const reading = new Promise((resolve) => { startReading = resolve; });
  const client = createChatClient({ base, fetchImpl: async (url) => {
    calls.push(url);
    return new Response(new ReadableStream({
      pull() { startReading(); },
    }), { headers: { "Content-Type": "text/event-stream" } });
  } });
  const pending = client.send({ message, signal: controller.signal });
  await reading;
  controller.abort();
  assert.equal((await pending).status, "failed");
  assert.deepEqual(calls, [streamUrl]);
});
