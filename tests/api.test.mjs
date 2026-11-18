import test from "node:test";
import assert from "node:assert/strict";
import { createApi, requestJson } from "../web/assets/api.mjs";
import { API_BASE } from "../web/assets/config.mjs";

test("health uses the fixed API and omits credentials and caches", async () => {
  const api = createApi({ fetchImpl: async (url, options) => {
    assert.equal(url, `${API_BASE}/api/v1/health`);
    assert.equal(options.method, "GET");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ status: "ok" });
  } });
  assert.deepEqual(await api.health(), { status: "ok" });
});

test("campus places become links with HTTPS sources only", async () => {
  const api = createApi({ base: "https://example.invalid/", fetchImpl: async (url) => {
    assert.equal(url, "https://example.invalid/api/v1/campus-guide");
    return Response.json({ places: [
      { name: "가상 안내소", purpose: "가상 안내", sources: [
        { url: "https://example.invalid/guide" }, { url: "http://example.invalid" },
        { url: "javascript:alert(1)" }, { url: "https://" }, { url: "https://bad host/" },
      ] },
      null, { name: "가상 장소", sources: [] },
    ] });
  } });
  assert.deepEqual(await api.campusGuide(), [
    { title: "가상 안내소", url: "https://example.invalid/guide", note: "가상 안내" },
  ]);
  assert.deepEqual(await createApi({ fetchImpl: async () => Response.json({ places: [] }) }).campusGuide(), []);
  await assert.rejects(createApi({ fetchImpl: async () => Response.json({}) }).campusGuide());
});

for (const failure of ["network", "server"]) {
  test(`${failure} failure retries GET once and can recover`, async () => {
    let calls = 0;
    const api = createApi({ fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        if (failure === "network") throw new TypeError("fictional network failure");
        return new Response(null, { status: 503 });
      }
      return Response.json({ status: "ok" });
    } });
    await api.health();
    assert.equal(calls, 2);
  });
}

for (const status of [400, 429, 503]) {
  test(`HTTP ${status} rejects with bounded attempts`, async () => {
    let calls = 0;
    const api = createApi({ fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status });
    } });
    await assert.rejects(api.health(), new RegExp(String(status)));
    assert.equal(calls, status === 503 ? 2 : 1);
  });
}

test("persistent network failure is tried twice", async () => {
  let calls = 0;
  await assert.rejects(createApi({ fetchImpl: async () => {
    calls += 1;
    throw new TypeError("fictional offline");
  } }).health());
  assert.equal(calls, 2);
});

test("invalid JSON rejects without retry", async () => {
  let calls = 0;
  await assert.rejects(createApi({ fetchImpl: async () => {
    calls += 1;
    return new Response("invalid JSON");
  } }).health(), SyntaxError);
  assert.equal(calls, 1);
});

test("GET retries a network failure while reading the response body", async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async () => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => { throw new TypeError("fictional disconnect"); } };
    return Response.json({ status: "ok" });
  } });
  assert.deepEqual(await api.health(), { status: "ok" });
  assert.equal(calls, 2);
});

for (const failure of ["network", "server"]) {
  test(`POST ${failure} failure is never retried`, async () => {
    let calls = 0;
    await assert.rejects(requestJson("https://example.invalid", {
      method: "POST", fetchImpl: async () => {
        calls += 1;
        if (failure === "network") throw new TypeError("fictional offline");
        return new Response(null, { status: 503 });
      },
    }));
    assert.equal(calls, 1);
  });
}

test("timeout aborts the request", async () => {
  await assert.rejects(requestJson("https://example.invalid", {
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  }), { name: "AbortError" });
});
