import test from "node:test";
import assert from "node:assert/strict";
import { createApi, requestJson, HANDWRITING_MAX_BYTES, isPngStructure } from "../web/assets/api.mjs";
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

test("JSON body is serialized with content type and preserves HTTP status", async () => {
  await assert.rejects(requestJson("https://example.invalid", {
    method: "POST", body: { fictional: true },
    fetchImpl: async (_url, options) => {
      assert.equal(options.body, '{"fictional":true}');
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
      return new Response(null, { status: 401 });
    },
  }), { status: 401 });
});

// ---- 손글씨 인식 ----

const PNG_HEAD = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// 앱 구현과 따로 계산하는 CRC-32(비트 단위). 형식 4바이트와 데이터를 덮는다.
function testCrc(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// 가상 PNG 청크: 길이 4바이트, 형식 4바이트, 데이터, CRC 4바이트. length·crc를 주면 그 값으로 덮어쓴다.
const chunk = (type, data = new Uint8Array(0), { length = data.length, crc } = {}) => {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, length);
  for (let i = 0; i < 4; i += 1) bytes[4 + i] = type.charCodeAt(i);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc ?? testCrc(bytes.subarray(4, 8 + data.length)));
  return bytes;
};
const ihdr = ({ width = 1, height = 1, depth = 8, color = 0, compression = 0, filter = 0, interlace = 0 } = {}) => {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data.set([depth, color, compression, filter, interlace], 8);
  return chunk("IHDR", data);
};
const ZLIB = [0x78, 0x9c]; // 사전 없는 deflate 머리
const idat = (size = 4, head = ZLIB) => {
  const data = new Uint8Array(size);
  data.set(head.slice(0, size));
  return chunk("IDAT", data);
};
const IEND = chunk("IEND");
const pngOf = (parts, type = "image/png") => new Blob([PNG_HEAD, ...parts], { type });
const PNG_OVERHEAD = PNG_HEAD.length + 25 + 12 + 12; // 서명 + IHDR + 빈 IDAT + IEND
// 구조가 맞는 가상 PNG(회색조 8비트). size를 주면 IDAT 데이터 길이로 맞춘다.
const png = (size = 64, type = "image/png") => pngOf([ihdr(), idat(size - PNG_OVERHEAD), IEND], type);

function handwritingApi(respond) {
  const calls = [];
  const api = createApi({ base: "https://example.invalid/", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return respond(url, options);
  } });
  return { api, calls };
}

test("handwriting sends multipart image and lang without content type or credentials", async () => {
  const { api, calls } = handwritingApi(() => Response.json({ text: "  가상 손글씨  " }));
  const image = png();
  assert.equal(await api.handwriting({ image, lang: "en" }), "가상 손글씨");
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, "https://example.invalid/api/v1/handwriting");
  assert.equal(options.method, "POST");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.headers, undefined, "multipart 경계는 브라우저가 붙인다");
  assert.ok(options.signal instanceof AbortSignal);
  assert.ok(options.body instanceof FormData);
  assert.deepEqual([...options.body.keys()], ["image", "lang"]);
  const file = options.body.get("image");
  assert.equal(file.name, "handwriting.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, image.size);
  assert.equal(options.body.get("lang"), "en");
});

test("handwriting sends lang only for ko, en and zh", async () => {
  for (const [lang, expected] of [["ko", "ko"], ["zh", "zh"], ["fr", null], [undefined, null], ["KO", null]]) {
    const { api, calls } = handwritingApi(() => Response.json({ text: "가상" }));
    await api.handwriting({ image: png(), lang });
    assert.equal(calls[0].options.body.get("lang"), expected, String(lang));
  }
});

for (const body of [{}, { text: "" }, { text: "  \n " }, { text: 3 }, null]) {
  test(`handwriting 200 without readable text rejects as 422: ${JSON.stringify(body)}`, async () => {
    const { api } = handwritingApi(() => Response.json(body));
    await assert.rejects(api.handwriting({ image: png() }), { status: 422 });
  });
}

test("handwriting 200 with invalid JSON rejects as 422", async () => {
  const { api } = handwritingApi(() => new Response("not json", { status: 200 }));
  await assert.rejects(api.handwriting({ image: png() }), { status: 422 });
});

for (const status of [400, 413, 415, 422, 429, 500, 503]) {
  test(`handwriting HTTP ${status} keeps status, ignores server text and is not retried`, async () => {
    const { api, calls } = handwritingApi(() => Response.json({ detail: "가상 서버 문구" }, { status }));
    await assert.rejects(api.handwriting({ image: png() }), (error) => {
      assert.equal(error.status, status);
      assert.doesNotMatch(error.message, /가상 서버 문구/);
      return true;
    });
    assert.equal(calls.length, 1);
  });
}

test("handwriting network failure is not retried", async () => {
  const { api, calls } = handwritingApi(() => {
    throw new TypeError("fictional offline");
  });
  await assert.rejects(api.handwriting({ image: png() }), TypeError);
  assert.equal(calls.length, 1);
});

test("handwriting rejects non-PNG and oversized images before fetch", async () => {
  const { api, calls } = handwritingApi(() => assert.fail("요청하면 안 된다"));
  const data = idat();
  const zeroFilled = new Uint8Array(64);
  zeroFilled.set(PNG_HEAD);
  const withHeader = (fields) => pngOf([ihdr(fields), data, IEND]);
  const palette = (entries) => chunk("PLTE", new Uint8Array(entries * 3));
  const text = chunk("tEXt", new Uint8Array(3));
  const goodIdat = new Uint8Array(await png().arrayBuffer()).subarray(PNG_HEAD.length + 25, PNG_HEAD.length + 25 + 12 + 7);
  const badCrc = Uint8Array.from(goodIdat);
  badCrc[badCrc.length - 1] ^= 0xff;
  const invalid = {
    "not a blob": [undefined, null, "data:image/png;base64,", { type: "image/png", size: 10 }],
    "wrong MIME": [png(64, "image/jpeg"), png(64, "")],
    "bad signature": [new Blob([new Uint8Array(64)], { type: "image/png" }), new Blob([PNG_HEAD.slice(0, 4)], { type: "image/png" })],
    "signature only": [pngOf([])],
    "signature then zeros": [new Blob([zeroFilled], { type: "image/png" })],
    "first chunk not IHDR": [pngOf([data, IEND]), pngOf([text, ihdr(), data, IEND])],
    "IHDR wrong length": [pngOf([chunk("IHDR", new Uint8Array(12)), data, IEND])],
    "zero width or height": [withHeader({ width: 0 }), withHeader({ height: 0 })],
    "dimension over 2^31-1": [withHeader({ width: 0x80000000 }), withHeader({ height: 0xffffffff })],
    "compression method not 0": [withHeader({ compression: 1 }), withHeader({ compression: 255 })],
    "filter method not 0": [withHeader({ filter: 1 })],
    "interlace not 0 or 1": [withHeader({ interlace: 2 })],
    "unknown color type": [withHeader({ color: 1 }), withHeader({ color: 5 }), withHeader({ color: 7 })],
    "bit depth not allowed for color": [withHeader({ depth: 3 }), withHeader({ color: 2, depth: 4 }),
      withHeader({ color: 4, depth: 1 }), withHeader({ color: 6, depth: 2 })],
    "palette rules": [
      withHeader({ color: 3 }), // 색 형식 3인데 PLTE 없음
      pngOf([ihdr(), palette(1), data, IEND]), // 회색조에 PLTE
      pngOf([ihdr({ color: 4 }), palette(1), data, IEND]),
      pngOf([ihdr({ color: 2 }), data, palette(1), IEND]), // IDAT 뒤 PLTE(트루컬러는 PLTE 선택)
      pngOf([ihdr({ color: 3 }), palette(1), palette(1), data, IEND]),
      pngOf([ihdr({ color: 3 }), chunk("PLTE", new Uint8Array(4)), data, IEND]),
      pngOf([ihdr({ color: 3 }), palette(257), data, IEND]),
      pngOf([ihdr({ color: 3, depth: 1 }), palette(3), data, IEND]), // 1비트는 2색까지
    ],
    "second IHDR": [pngOf([ihdr(), ihdr(), data, IEND])],
    "IDAT not consecutive": [pngOf([ihdr(), data, text, data, IEND])],
    "unknown critical or malformed chunk": [pngOf([ihdr(), chunk("ZZZZ"), data, IEND]),
      pngOf([ihdr(), chunk("IDA1"), data, IEND]), pngOf([ihdr(), chunk("tExt"), data, IEND])], // 셋째 글자(예약 비트)는 대문자여야 한다
    "bad CRC": [pngOf([ihdr(), badCrc, IEND]), pngOf([ihdr(), data, chunk("IEND", undefined, { crc: 0 })])],
    "bad zlib header": [pngOf([ihdr(), idat(4, [0, 0]), IEND]), pngOf([ihdr(), idat(4, [0x79, 0x9c]), IEND]),
      pngOf([ihdr(), idat(4, [0x78, 0x9d]), IEND]), pngOf([ihdr(), idat(4, [0x78, 0xbb]), IEND]),
      pngOf([ihdr(), idat(1, [0x78]), IEND]), pngOf([ihdr(), idat(0), IEND])],
    "no IDAT": [pngOf([ihdr(), IEND])],
    "no IEND": [pngOf([ihdr(), data])],
    "IEND with data": [pngOf([ihdr(), data, chunk("IEND", new Uint8Array(1))])],
    "bytes after IEND": [pngOf([ihdr(), data, IEND, new Uint8Array(1)])],
    "chunk longer than file": [pngOf([ihdr(), chunk("IDAT", Uint8Array.from([0x78, 0x9c, 0, 0]), { length: 100 }), IEND])],
  };
  for (const [name, images] of Object.entries(invalid)) {
    for (const image of images) await assert.rejects(api.handwriting({ image }), { status: 415 }, name);
  }
  await assert.rejects(api.handwriting({ image: png(HANDWRITING_MAX_BYTES + 1) }), { status: 413 });
  assert.equal(calls.length, 0);
  assert.equal(HANDWRITING_MAX_BYTES, 2000000);
});

test("isPngStructure accepts IHDR, IDAT and IEND in order, also inside a larger buffer", async () => {
  const bytes = new Uint8Array(await png(80).arrayBuffer());
  assert.equal(isPngStructure(bytes), true);
  const padded = new Uint8Array(bytes.length + 6);
  padded.set(bytes, 3);
  assert.equal(isPngStructure(padded.subarray(3, 3 + bytes.length)), true, "byteOffset이 있어도 읽는다");
  const valid = async (parts) => isPngStructure(new Uint8Array(await pngOf(parts).arrayBuffer()));
  assert.equal(await valid([ihdr(), chunk("tEXt", new Uint8Array(3)), idat(1, [0x78]), idat(3, [0x9c]), IEND]), true,
    "보조 청크와 여러 IDAT, IDAT 경계에 걸친 zlib 머리 허용");
  assert.equal(await valid([ihdr({ color: 3, depth: 1 }), chunk("PLTE", new Uint8Array(6)), idat(), IEND]), true, "팔레트 2색");
  assert.equal(await valid([ihdr({ color: 3 }), chunk("PLTE", new Uint8Array(768)), idat(), IEND]), true, "팔레트 256색");
  assert.equal(await valid([ihdr({ color: 2 }), chunk("PLTE", new Uint8Array(3)), idat(), IEND]), true, "트루컬러의 선택 PLTE");
  assert.equal(await valid([ihdr({ color: 6, depth: 16, interlace: 1, width: 1024, height: 300 }), idat(), IEND]), true);
  assert.equal(await valid([ihdr({ width: 0x7fffffff, height: 0x7fffffff }), idat(), IEND]), true, "명세 최대 크기");
  for (const [color, depths] of [[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [4, [8, 16]], [6, [8, 16]]]) {
    for (const depth of depths) assert.equal(await valid([ihdr({ color, depth }), idat(), IEND]), true, `${color}/${depth}`);
  }
  assert.equal(isPngStructure(bytes.subarray(0, bytes.length - 1)), false);
  assert.equal(isPngStructure(PNG_HEAD), false);
  assert.equal(isPngStructure([...bytes]), false, "Uint8Array만 받는다");
});

test("handwriting accepts an image of exactly 2,000,000 bytes", async () => {
  const { api, calls } = handwritingApi(() => Response.json({ text: "가상" }));
  assert.equal(await api.handwriting({ image: png(HANDWRITING_MAX_BYTES) }), "가상");
  assert.equal(calls[0].options.body.get("image").size, HANDWRITING_MAX_BYTES);
});

const hang = (_url, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener("abort", () => reject(signal.reason), { once: true });
});

test("handwriting stops when the caller aborts and skips fetch if already aborted", async () => {
  let started;
  const fetchStarted = new Promise((resolve) => {
    started = resolve;
  });
  const { api, calls } = handwritingApi((url, options) => {
    started();
    return hang(url, options);
  });
  const controller = new AbortController();
  const pending = api.handwriting({ image: png(), signal: controller.signal });
  await fetchStarted;
  assert.equal(calls.length, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });

  const done = new AbortController();
  done.abort();
  await assert.rejects(api.handwriting({ image: png(), signal: done.signal }), { name: "AbortError" });
  assert.equal(calls.length, 1);
});

test("handwriting has its own time limit", async () => {
  const api = createApi({ base: "https://example.invalid", fetchImpl: hang, handwritingTimeoutMs: 5 });
  await assert.rejects(api.handwriting({ image: png() }), { name: "TimeoutError" });
});

test("demo API encodes student ID and blocks arbitrary login input", async () => {
  const calls = [];
  const api = createApi({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return Response.json({});
  } });
  await api.demoStudents();
  await api.demoLogin("demo-d02");
  await api.graduationDemo("fictional & id");
  assert.match(calls[0].url, /\/demo-students$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    student_number: "20990002", password: "demo-d02-pass",
  });
  assert.match(calls[2].url, /\/graduation-demo\?student_id=fictional%20%26%20id$/);
  for (const id of ["fictional-id", "__proto__", " demo-d02", null, {}]) {
    await assert.rejects(api.demoLogin(id), { status: 401 });
  }
  assert.equal(calls.length, 3);
});
