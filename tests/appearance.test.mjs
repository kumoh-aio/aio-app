import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mountAppearance } from "../web/assets/appearance.mjs";

const read = (path) => readFileSync(new URL(`../web/${path}`, import.meta.url), "utf8");
const colorKey = "aio.appearance.color.v1";
const effectKey = "aio.appearance.effect.v1";
const colors = ["system", "light", "dark"];
const effects = ["basic", "neumorphic"];
const lightBg = "#F5F8FC";
const darkBg = "#0B1626";
const media = (scheme) => `(prefers-color-scheme: ${scheme})`;

function element(attrs = {}) {
  const values = new Map(Object.entries(attrs));
  return {
    getAttribute: (name) => values.get(name) ?? null,
    setAttribute: (name, value) => values.set(name, String(value)),
    removeAttribute: (name) => values.delete(name),
  };
}

function fakeDocument() {
  const documentElement = element();
  const metas = [
    element({ content: lightBg, media: media("light") }),
    element({ content: darkBg, media: media("dark") }),
  ];
  const radios = { color: new Map(), effect: new Map() };
  for (const [group, choices] of [["color", colors], ["effect", effects]]) {
    for (const value of choices) {
      const radio = element({ "data-appearance": group, type: "radio", name: group, value });
      const events = new Map();
      Object.assign(radio, {
        value,
        checked: false,
        addEventListener: (name, listener) => events.set(name, listener),
        select() {
          for (const item of radios[group].values()) item.checked = item === radio;
          events.get("change")({ target: radio, currentTarget: radio });
        },
      });
      radios[group].set(value, radio);
    }
  }
  const doc = {
    documentElement,
    querySelectorAll(selector) {
      if (selector === 'meta[name="theme-color"]') return metas;
      if (selector === "input[data-appearance]") return [...radios.color.values(), ...radios.effect.values()];
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  return { doc, radios, metas, root: documentElement };
}

function storageFixture(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

function assertAppearance({ root, radios, metas }, color, effect) {
  assert.equal(root.getAttribute("data-color-mode"), color);
  assert.equal(root.getAttribute("data-theme"),
    effect === "neumorphic" ? "neumorphic" : null);
  for (const [group, expected] of [["color", color], ["effect", effect]]) {
    for (const [value, radio] of radios[group]) {
      assert.equal(radio.checked, expected === value, `${group}: ${value}`);
      assert.equal(radio.getAttribute("aria-checked"), String(expected === value));
    }
  }
  assert.deepEqual(metas.map((meta) => [meta.getAttribute("media"), meta.getAttribute("content")]),
    color === "system"
      ? [[media("light"), lightBg], [media("dark"), darkBg]]
      : [["all", color === "light" ? lightBg : darkBg], ["all", color === "light" ? lightBg : darkBg]]);
}

test("화면 설정은 두 값을 따로 복원하고 기기에 저장한다", () => {
  const screen = fakeDocument();
  const storage = storageFixture({ [colorKey]: "dark", [effectKey]: "neumorphic" });
  mountAppearance({ doc: screen.doc, storage });
  assertAppearance(screen, "dark", "neumorphic");

  screen.radios.color.get("light").select();
  assertAppearance(screen, "light", "neumorphic");
  assert.equal(storage.data.get(colorKey), "light");
  assert.equal(storage.data.get(effectKey), "neumorphic");
  screen.radios.effect.get("basic").select();
  assertAppearance(screen, "light", "basic");
  assert.equal(storage.data.get(colorKey), "light");
  assert.equal(storage.data.get(effectKey), "basic");
  screen.radios.color.get("system").select();
  assertAppearance(screen, "system", "basic");
  assert.equal(storage.data.get(colorKey), "system");
});

test("기본값은 시스템과 기본 효과이고 손상된 값은 그 설정만 초기화한다", () => {
  for (const [initial, color, effect] of [
    [{}, "system", "basic"],
    [{ [colorKey]: "sepia", [effectKey]: "neumorphic" }, "system", "neumorphic"],
    [{ [colorKey]: "dark", [effectKey]: "raised" }, "dark", "basic"],
  ]) {
    const screen = fakeDocument();
    mountAppearance({ doc: screen.doc, storage: storageFixture(initial) });
    assertAppearance(screen, color, effect);
  }
});

test("저장소가 없거나 읽고 쓰지 못해도 현재 화면과 브라우저 색을 바꾼다", () => {
  const fail = () => { throw new Error("가상 저장소 오류"); };
  const unavailable = [null, { getItem: fail, setItem: fail }];
  for (const storage of unavailable) {
    const screen = fakeDocument();
    mountAppearance({ doc: screen.doc, storage });
    assertAppearance(screen, "system", "basic");
    screen.radios.color.get("dark").select();
    screen.radios.effect.get("neumorphic").select();
    assertAppearance(screen, "dark", "neumorphic");
    screen.radios.color.get("system").select();
    assertAppearance(screen, "system", "neumorphic");
  }
});

test("스크립트 실행 전에도 시스템 색에 맞는 meta가 있고 더보기는 네이티브 라디오를 쓴다", () => {
  const html = read("index.html");
  const metas = [...html.matchAll(/<meta\b[^>]*name="theme-color"[^>]*>/g)].map(([tag]) => [
    tag.match(/\bmedia="([^"]+)"/)?.[1],
    tag.match(/\bcontent="([^"]+)"/)?.[1],
  ]);
  assert.deepEqual(metas, [[media("light"), lightBg], [media("dark"), darkBg]]);
  const more = html.match(/<section[^>]*data-view="more"[\s\S]*?<\/main>/)?.[0] ?? "";
  assert.match(more, /화면 설정/);
  const inputs = [...more.matchAll(/<input\b[^>]*>/g)].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]+)"/g)].map(([, key, value]) => [key, value])));
  for (const [group, choices] of [["color", colors], ["effect", effects]]) {
    const radios = inputs.filter((input) => input["data-appearance"] === group);
    assert.deepEqual(radios.map((radio) => radio.value), choices);
    assert.ok(radios.every((radio) => radio.type === "radio" && radio.name && radio.name === radios[0].name));
  }
  assert.notEqual(inputs[0].name, inputs.at(-1).name);
});

function luminance(hex) {
  return hex.slice(1).match(/../g).reduce((sum, channel, index) => {
    const value = Number.parseInt(channel, 16) / 255;
    const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][index];
  }, 0);
}

function assertContrast(foreground, background, minimum, label) {
  assert.match(foreground ?? "", /^#[\da-f]{6}$/i, label);
  assert.match(background ?? "", /^#[\da-f]{6}$/i, label);
  const levels = [luminance(foreground), luminance(background)];
  const ratio = (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05);
  assert.ok(ratio >= minimum, `${label}: ${ratio.toFixed(2)}:1 < ${minimum}:1`);
}

test("라이트·다크 토큰의 본문과 채움 글자는 4.5:1이고 컨트롤 경계는 3:1이다", () => {
  const css = read("assets/app.css");
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const tokens = (body) => Object.fromEntries(
    [...body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
  const light = tokens(rules.find(([, selector]) => selector.trim() === ":root")?.[2] ?? "");
  const darkRule = rules.find(([, selector, body]) => selector.includes('[data-color-mode="dark"]')
    && tokens(body).paper === darkBg);
  assert.ok(darkRule, "dark palette");
  const dark = { ...light, ...tokens(darkRule[2]) };
  const systemRule = css.match(/@media \(prefers-color-scheme: dark\)\s*\{[^{}]+\{([^{}]*)\}/)?.[1] ?? "";
  assert.deepEqual({ ...light, ...tokens(systemRule) }, dark, "system dark uses the same palette");
  const darkShadows = (body) => [...body.matchAll(/--shadow-(?:raised|recessed):[^;]+;/g)].map(([rule]) => rule);
  assert.deepEqual(darkShadows(systemRule), darkShadows(darkRule[2]));

  for (const [palette, expected] of [[light, {
    paper: lightBg, surface: "#FFFFFF", text: "#0A2540", "text-muted": "#4A5D75",
    "school-blue": "#005B96", "sky-text": "#0071A4", sky: "#00A3D9",
    yellow: "#FFD100", coral: "#FF7A59", success: "#0F7A43", warn: "#9A5B00", error: "#C62F2F",
  }], [dark, {
    paper: darkBg, surface: "#13233A", raised: "#1A2B44", text: "#E8EEF6", "text-muted": "#9DB0C7",
    "school-blue": "#3DB8E8", yellow: "#FFD100", coral: "#FF8F73",
    success: "#4ADE80", warn: "#FBBF24", error: "#F87171",
  }]]) {
    const resolve = (key) => {
      const value = palette[key];
      const alias = value?.match(/^var\(--color-([\w-]+)\)$/)?.[1];
      return alias ? resolve(alias) : value?.toUpperCase();
    };
    for (const [key, hex] of Object.entries(expected)) assert.equal(resolve(key), hex, key);
    const faces = ["paper", "surface", "raised"].filter((key) => palette[key]);
    for (const face of faces) {
      for (const ink of ["text", "text-muted", "school-blue", "sky-text", "success", "warn", "error"]) {
        assertContrast(resolve(ink), resolve(face), 4.5, `${expected.paper} ${ink} on ${face}`);
      }
      assertContrast(resolve("control-border"), resolve(face), 3, `${expected.paper} control on ${face}`);
      assertContrast(resolve("school-blue"), resolve(face), 3, `${expected.paper} focus on ${face}`);
    }
    for (const fill of ["sky", "yellow", "coral"]) {
      assertContrast(resolve("navy"), resolve(fill), 4.5, `navy on ${fill}`);
    }
    assertContrast(resolve("on-accent"), resolve("school-blue"), 4.5, "text on accent");
  }
});

test("달력 분류 칩과 주말 틴트 토큰은 세 색 블록에 있고 대비를 지킨다", () => {
  const css = read("assets/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = (body) => Object.fromEntries(
    [...body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
  const block = (pattern) => tokens(css.match(pattern)?.[1] ?? "");
  const light = block(/(?:^|\})\s*:root\s*\{([^{}]*)\}/);
  const dark = { ...light, ...block(/:root\[data-color-mode="dark"\]\s*\{([^{}]*)\}/) };
  const system = { ...light, ...block(/@media \(prefers-color-scheme: dark\)\s*\{[^{}]+\{([^{}]*)\}/) };
  const categories = ["enroll", "exam", "holiday", "register", "other"];
  const keys = ["cal-weekend", ...categories.flatMap((name) => [`cal-${name}-bg`, `cal-${name}-ink`])];
  const darkOwn = block(/:root\[data-color-mode="dark"\]\s*\{([^{}]*)\}/);
  const systemOwn = block(/@media \(prefers-color-scheme: dark\)\s*\{[^{}]+\{([^{}]*)\}/);
  for (const key of keys) {
    assert.ok(light[key] && darkOwn[key] && systemOwn[key], `${key} in light, dark and system dark`);
    assert.equal(systemOwn[key], darkOwn[key], `${key} system dark matches dark`);
  }
  for (const [label, palette] of [["light", light], ["dark", dark], ["system", system]]) {
    const resolve = (key) => {
      const alias = palette[key]?.match(/^var\(--color-([\w-]+)\)$/)?.[1];
      return alias ? resolve(alias) : palette[key]?.toUpperCase();
    };
    const card = resolve("raised") ?? resolve("surface");
    for (const name of categories) {
      assertContrast(resolve(`cal-${name}-ink`), resolve(`cal-${name}-bg`), 4.5, `${label} ${name} chip`);
      assertContrast(resolve(`cal-${name}-ink`), card, 3, `${label} ${name} dot on card`);
      assertContrast(resolve(`cal-${name}-ink`), resolve("cal-weekend"), 3, `${label} ${name} dot on weekend`);
      // 막대 채움은 칸 배경과 거의 같아(금~일 등록 일정의 토요일 칸 약 1.02:1) 경계는 글자색 외곽선이 맡는다.
      for (const [face, back] of [["card", card], ["weekend", resolve("cal-weekend")]]) {
        assertContrast(resolve(`cal-${name}-ink`), back, 3, `${label} ${name} bar outline on ${face}`);
      }
    }
    for (const ink of ["text", "text-muted"]) {
      assertContrast(resolve(ink), resolve("cal-weekend"), 4.5, `${label} ${ink} on weekend tint`);
    }
    assertContrast(resolve("school-blue"), resolve("cal-weekend"), 3, `${label} selected ring on weekend`);
  }
});

test("달력 격자는 9% 헤어라인과 대체 경계를 쓰고 좁은 화면에서 막대 대신 점을 보인다", () => {
  const css = read("assets/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(rule(".calendar-month"), /--calendar-line:\s*var\(--color-border\)/);
  assert.match(css, /@supports \(color: color-mix\(in srgb, red 9%, transparent\)\)\s*\{\s*\.calendar-month\s*\{\s*--calendar-line:\s*color-mix\(in srgb, var\(--color-text\) 9%, transparent\);/);
  // 320px 화면: 본문 여백(16px×2)과 테두리를 빼면 7열이 44px 밑으로 내려가므로 열 최소값과 여백 밖 확장을 둔다.
  assert.match(rule(".calendar-week"), /grid-template-columns:\s*repeat\(7, minmax\(var\(--touch\), 1fr\)\)/);
  assert.match(rule(".calendar-bars"), /grid-template-columns:\s*repeat\(7, minmax\(var\(--touch\), 1fr\)\)/);
  assert.match(rule(".calendar-month"), /overflow-x:\s*auto/);
  const smallest = [...css.matchAll(/@media \(max-width: 380px\)\s*\{([\s\S]*?)\n\}/g)].map(([, body]) => body).join("\n");
  assert.match(smallest, /\.calendar-month\s*\{\s*margin-inline:\s*calc\(var\(--gap\) \* -1\);\s*border-inline-width:\s*0;/);  assert.match(rule(".calendar-bars"), /pointer-events:\s*none/, "막대는 칸 누르기를 막지 않는다");
  const bar = rule(".calendar-bar");
  assert.match(bar, /border:\s*1px solid var\(--cal-ink, var\(--color-cal-other-ink\)\)/, "막대 기간 경계는 분류 글자색 외곽선");
  assert.match(bar, /line-height:\s*calc\(var\(--calendar-bar-height\) - 2px\)/, "외곽선 두께만큼 줄 높이를 줄인다");
  assert.match(rule(".calendar-bar.is-continued-before"), /border-left-width:\s*0/);
  assert.match(rule(".calendar-bar.is-continued-after"), /border-right-width:\s*0/);
  assert.match(rule(".calendar-day.is-weekend"), /background:\s*var\(--color-cal-weekend\)/);
  assert.match(rule(".calendar-day.is-outside"), /color:\s*var\(--color-text-muted\)/);
  assert.match(css, /\.calendar-day\.is-today > [^{]+\{[^}]*background:\s*var\(--color-school-blue\);[^}]*color:\s*var\(--color-on-accent\)/);
  assert.match(rule(".calendar-day.is-selected"), /box-shadow:\s*inset 0 0 0 2px var\(--color-school-blue\)/);
  assert.match(css, /\.calendar-viewswitch button,\s*\.calendar-nav button \{[^}]*min-width:\s*var\(--touch\);\s*min-height:\s*var\(--touch\)/);
  for (const name of ["enroll", "exam", "holiday", "register", "other"]) {
    assert.match(css, new RegExp(`\\.calendar-cat-${name} \\{ --cal-bg: var\\(--color-cal-${name}-bg\\); --cal-ink: var\\(--color-cal-${name}-ink\\); \\}`));
  }
  // 목록·고른 날 카드도 분류 클래스가 붙으면 왼쪽 선이 점·막대와 같은 색이 된다. 기본 카드 규칙 뒤에서 덮는다.
  const cardCat = css.indexOf('.calendar-event[class*="calendar-cat-"] {');
  assert.ok(cardCat > css.indexOf(".calendar-event {") && cardCat > css.indexOf(".card {"), "카드 분류 선 규칙 위치");
  assert.match(css.slice(cardCat, css.indexOf("}", cardCat)), /border-left-color:\s*var\(--cal-ink\)/);
  const narrow = [...css.matchAll(/@media \(max-width: 600px\)\s*\{([\s\S]*?)\n\}/g)].map(([, body]) => body).join("\n");
  assert.match(narrow, /\.calendar-bars,\s*\.calendar-more\s*\{\s*display:\s*none;/);
  assert.match(narrow, /\.calendar-dots\s*\{\s*display:\s*flex;/);
  assert.match(narrow, /\.calendar-day\s*\{[^}]*min-height:\s*calc\(var\(--touch\) \+ 6px\)/);
  assert.match(rule(".calendar-dots"), /display:\s*none/, "넓은 화면에서는 점을 숨긴다");
  const calendarAt = css.indexOf(".calendar-month {");
  assert.ok(calendarAt < css.indexOf(".more {"), "달력 규칙은 더보기 구역 앞에 둔다");
  assert.ok(calendarAt < css.lastIndexOf(":focus-visible"));
  assert.doesNotMatch(css.slice(calendarAt, css.indexOf(".more {")), /gradient|backdrop-filter/);
});

// 분류색은 CSS만으로 정할 수 없고 카드 렌더러가 calendar-cat-* 클래스를 붙여야 한다.
// CSS 규칙만 보던 검사는 렌더러 누락을 놓쳤으므로, 달력 보기가 합쳐진 코드에서는 렌더러 원문을 직접 본다.
function integratedCalendarSource(t) {
  const source = read("assets/calendar-view.mjs");
  if (process.env.AIO_REQUIRE_FULL_SHELL === "1" || source.includes("calendar-month")) return source;
  t.skip("달력 보기 모듈이 아직 이 체크아웃에 합쳐지지 않았음");
  return null;
}

test("통합 달력 보기: 목록·고른 날 공통 카드 렌더러가 분류 클래스를 붙인다", (t) => {
  const source = integratedCalendarSource(t);
  if (source === null) return;
  const renderer = source.match(/^([ \t]*)(?:export\s+)?function renderEvent\s*\([^)]*\)\s*\{([\s\S]*?)\r?\n\1\}/m);
  assert.ok(renderer, "목록과 고른 날 목록이 함께 쓰는 renderEvent 함수");
  const body = renderer[2];
  assert.match(body, /calendar-event/, "renderEvent가 일정 카드를 만든다");
  assert.match(body, /calendar-cat-|categor|classif/i,
    "같은 날 가상 시험·휴일 카드도 분류 클래스를 받아야 목록 보기와 고른 날 목록의 왼쪽 선이 분류색이 된다");
});

test("통합 달력 보기: 격자 첫 행에 일~토 요일 머리를 그린다", (t) => {
  const source = integratedCalendarSource(t);
  if (source === null) return;
  assert.match(source, /["']columnheader["']/);
});

// ---- 아이오 빠른 실행 링 ----

function qaCss() {
  const css = read("assets/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  // 주석이 일찍 닫히면 남은 설명 줄이 다음 선택자에 붙어 규칙 전체가 버려진다.
  assert.doesNotMatch(css, /\*\//, "주석 밖에 남은 */가 없다");
  assert.match(css, /\}\s*\.qa-defs \{/, ".qa-defs 선택자 앞에는 이전 규칙의 닫는 괄호만 온다");
  const start = css.indexOf(".qa-defs {");
  const end = css.lastIndexOf(":focus-visible");
  assert.ok(start > 0 && start < end, "빠른 실행 링 규칙은 마지막 포커스 규칙 앞에 둔다");
  const block = css.slice(start, end);
  const rule = (selector) => {
    const at = block.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return block.slice(at, block.indexOf("}", at));
  };
  return { css, block, rule };
}

function palettes() {
  const css = read("assets/app.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const tokens = (body) => Object.fromEntries(
    [...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
  const block = (pattern) => tokens(css.match(pattern)?.[1] ?? "");
  const light = block(/(?:^|\})\s*:root\s*\{([^{}]*)\}/);
  const dark = { ...light, ...block(/:root\[data-color-mode="dark"\]\s*\{([^{}]*)\}/) };
  const system = { ...light, ...block(/@media \(prefers-color-scheme: dark\)\s*\{[^{}]+\{([^{}]*)\}/) };
  return [["light", light], ["dark", dark], ["system", system]].map(([label, palette]) => {
    const resolve = (value) => {
      const alias = value?.match(/^var\(--([\w-]+)\)$/)?.[1];
      return alias ? resolve(palette[alias]) : value?.toUpperCase();
    };
    return [label, resolve];
  });
}

test("빠른 실행 링: goo 필터는 아이오 화면 밖 크기 0 장식 SVG에 정해진 값으로 있다", () => {
  const html = read("index.html");
  const svgs = [...html.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/g)];
  const defs = svgs.filter(([, , body]) => body.includes('id="aio-goo"'));
  assert.equal(defs.length, 1, "필터 정의는 한 곳");
  const [whole, attrs, body] = defs[0];
  assert.match(attrs, /\baria-hidden="true"/);
  assert.match(attrs, /\bwidth="0"/);
  assert.match(attrs, /\bheight="0"/);
  assert.doesNotMatch(whole, /\sstyle\s*=|xmlns|https?:|href/i, "style 속성·외부 주소 없음");

  const at = html.indexOf(whole);
  assert.ok(at > html.indexOf("</main>") && at > html.indexOf("</nav>"), "아이오 화면 구역과 탭 막대 밖");
  assert.ok(at < html.indexOf("</body>"), "</body> 바로 앞");
  const aio = html.match(/<section class="view" data-view="aio"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.doesNotMatch(aio, /aio-goo|<svg/, "아이오 화면 구역 마크업은 그대로");

  const filter = body.match(/<filter\b([^>]*)>([\s\S]*?)<\/filter>/);
  assert.ok(filter, "filter 요소");
  const filterAttrs = Object.fromEntries([...filter[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
  assert.equal(filterAttrs.id, "aio-goo");
  assert.equal(filterAttrs["color-interpolation-filters"], "sRGB");
  // 흐림이 번지는 3σ(30px)만큼 잘리지 않도록 경계 상자 바깥까지 필터 영역을 넓힌다.
  assert.deepEqual([filterAttrs.x, filterAttrs.y, filterAttrs.width, filterAttrs.height], ["-50%", "-50%", "200%", "200%"]);

  const primitives = [...filter[2].matchAll(/<(fe\w+)\b([^>]*)\/?>/g)].map(([, name, rest]) => [name,
    Object.fromEntries([...rest.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]))]);
  assert.deepEqual(primitives.map(([name]) => name), ["feGaussianBlur", "feColorMatrix"]);
  const [[, blur], [, matrix]] = primitives;
  assert.equal(Number(blur.stdDeviation), 10);
  assert.equal(matrix.type, "matrix");
  assert.equal(matrix.in, blur.result, "흐린 결과에 알파 행렬을 건다");
  const values = matrix.values.trim().split(/\s+/).map(Number);
  assert.equal(values.length, 20);
  assert.deepEqual(values.slice(0, 15), [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0], "색 채널은 그대로");
  assert.deepEqual(values.slice(15), [0, 0, 0, 19, -9], "알파 행");

  // 필터 정의 SVG를 display: none으로 숨기면 일부 브라우저가 참조를 잃는다.
  const { rule } = qaCss();
  assert.doesNotMatch(rule(".qa-defs"), /display:\s*none/);
  assert.match(rule(".qa-defs"), /position:\s*absolute/);
});

test("빠른 실행 링: 장식 레이어는 누르기를 막지 않고 버튼·라벨은 필터 밖 44px 이상이다", () => {
  const { css, block, rule } = qaCss();
  assert.doesNotMatch(block, /url\(|gradient|backdrop-filter|filter:/, "CSS 필터·그라데이션·유리 효과 없음");
  // 링은 + 버튼과 떨어진 자리(입력 행 뒤)에 붙어도 트리거 중심에서 펼쳐지도록 화면 고정 레이어에 원점 변수를 쓴다.
  const ring = rule(".qa-ring");
  assert.match(ring, /position:\s*fixed;\s*inset:\s*0;/);
  assert.match(ring, /pointer-events:\s*none/, "닫힌 링 레이어가 화면 누르기를 막지 않는다");
  assert.match(rule(".qa-items"), /top:\s*var\(--qa-origin-y, 0px\);\s*left:\s*var\(--qa-origin-x, 0px\);/);
  // 크기 0 SVG는 그려지지 않으므로 장식 SVG는 화면 전체를 덮는다. viewBox 폭(innerWidth)은 세로 스크롤바를
  // 포함하므로 100%(스크롤바 제외) 대신 같은 기준인 100vw·100dvh로 맞춰 채움이 축소되지 않게 한다.
  const goo = rule(".qa-goo");
  assert.match(goo, /top:\s*0;\s*left:\s*0;\s*width:\s*100vw;\s*height:\s*100vh;\s*height:\s*100dvh;/);
  assert.doesNotMatch(goo, /(?:width|height):\s*100%/, "스크롤바를 뺀 폭은 viewBox와 어긋난다");
  assert.doesNotMatch(goo, /(?:^|[^-])(?:width|height):\s*0/, "장식 SVG viewport는 0이 아니다");
  assert.match(goo, /pointer-events:\s*none/);
  assert.match(goo, /opacity:\s*0/, "닫힌 링의 채움은 + 버튼을 가리지 않는다");
  assert.match(rule('.qa-ring[data-open="true"] .qa-goo'), /opacity:\s*1/);
  assert.match(rule(".qa-blob"), /fill:\s*var\(--color-school-blue\)/);

  const size = Number(rule(".qa-ring").match(/--qa-size:\s*(\d+)px/)?.[1]);
  assert.ok(size >= 44, `버블 지름 ${size}px`);
  // 배치 함수와 채움 원(r = 지름/2)은 설계 문서의 지름을 쓴다. 버튼 지름이 다르면 버튼과 채움 크기가 어긋난다.
  const designDoc = readFileSync(new URL("../docs/DESIGN.md", import.meta.url), "utf8");
  const designSize = Number(designDoc.match(/버블 지름은 `--qa-size: (\d+)px`/)?.[1]);
  assert.equal(size, designSize, "CSS 버블 지름은 설계 문서 값과 같다");
  assert.equal(size, 48, "동작 작업의 배치·채움 원 지름 48px(r 24)과 같다");
  const item = rule(".qa-item");
  assert.match(item, /width:\s*var\(--qa-size\);\s*height:\s*var\(--qa-size\)/);
  assert.match(item, /min-width:\s*var\(--touch\);\s*min-height:\s*var\(--touch\)/);
  assert.match(item, /border:\s*1px solid var\(--color-control-border\)/);
  assert.match(item, /color:\s*var\(--color-on-accent\)/);
  assert.match(item, /pointer-events:\s*none/, "닫힌 버블은 누를 수 없다");
  assert.doesNotMatch(item, /outline/, "포커스는 공통 외곽선을 쓴다");

  // 버튼은 원점에 놓인 .qa-items 안에서, 채움은 viewBox로 원점이 트리거 중심에 맞춰진 SVG 안에서 움직인다.
  // 두 레이어 모두 원점 기준이므로 같은 이동량만 쓰고, 채움에 원점을 다시 더하면 트리거 좌표만큼 밀린다.
  const transformOf = (selector) => rule(selector).match(/transform:\s*([^;]+);/)?.[1].replace(/\s+/g, " ").trim();
  for (const layer of [".qa-blob", ".qa-item"]) {
    assert.equal(transformOf(layer), "translate(0px, 0px) scale(0.4)", `${layer} 닫힘`);
    assert.equal(transformOf(`.qa-ring[data-open="true"] ${layer}`),
      "translate(var(--qa-x, 0px), var(--qa-y, 0px)) scale(1)", `${layer} 열림`);
  }
  assert.equal(transformOf('.qa-ring[data-open="true"] .qa-blob'), transformOf('.qa-ring[data-open="true"] .qa-item'),
    "채움과 버튼은 같은 자리로 펼쳐진다");
  for (const selector of [".qa-blob", '.qa-ring[data-open="true"] .qa-blob']) {
    assert.doesNotMatch(rule(selector), /--qa-origin/, `${selector}는 원점을 다시 더하지 않는다`);
  }
  // 채움 원은 버블마다 하나다. 진입점이 만들지 않는 가운데 원 규칙을 남기면 설계와 화면이 어긋난다.
  assert.doesNotMatch(css, /data-qa-hub/, "가운데 원 규칙을 두지 않는다");
  const design = readFileSync(new URL("../docs/DESIGN.md", import.meta.url), "utf8");
  const ringDoc = design.slice(design.indexOf("## 아이오 빠른 실행 링"));
  assert.ok(ringDoc.length > 0 && design.includes("## 아이오 빠른 실행 링"), "설계 절");
  assert.doesNotMatch(ringDoc, /data-qa-hub|가운데 원 1개|버블 수보다 하나 많다/, "설계도 버블마다 채움 원 하나");
  // 설계 표는 액션 ID 순서와 ko 라벨만 적고, en·zh 문구는 앱 문구 표를 원본으로 삼아 두 벌로 어긋나지 않게 한다.
  const rows = [...ringDoc.matchAll(/^\| (\d) \| `([a-z]+)` \| ([^|]+) \|/gm)].map(([, order, id, ko]) => [order, id, ko.trim()]);
  assert.deepEqual(rows, [["1", "calendar", "학사일정"], ["2", "graduation", "졸업 진단"],
    ["3", "biskit", "BISKIT 추천"], ["4", "handwriting", "손글씨 입력"]]);
  assert.doesNotMatch(ringDoc, /Academic calendar|Graduation check|学年日程|毕业审核/, "실제 화면과 다른 예전 문구");
  assert.match(ringDoc, /--qa-label-x`·`--qa-label-y`/, "배치 함수가 라벨 자리를 넘기는 계약");
  assert.match(rule('.qa-ring[data-open="true"] .qa-item'), /pointer-events:\s*auto/);

  const label = rule(".qa-label");
  assert.match(label, /pointer-events:\s*none/);
  assert.match(label, /white-space:\s*nowrap/);
  assert.match(label, /max-width:\s*calc\(100vw - 8px\)/);
  assert.match(label, /top:\s*50%;\s*left:\s*50%;/, "라벨 기준점은 버블 중심");
  assert.doesNotMatch(label, /bottom:/, "모든 라벨을 버블 위에 고정하지 않는다");
  const decl = (name) => label.match(new RegExp(`--qa-label-${name}:\\s*([^;]+);`))?.[1].replace(/\s+/g, " ").trim();
  assert.deepEqual(Object.fromEntries(["cx", "cy", "gap", "dx", "above", "side", "flip", "dy"].map((name) => [name, decl(name)])), {
    cx: "calc(var(--qa-origin-x, 0px) + var(--qa-x, 0px))",
    cy: "calc(var(--qa-origin-y, 0px) + var(--qa-y, 0px))",
    gap: "calc(var(--qa-size) / 2 + 4px)",
    // 배치 함수가 넘긴 라벨 자리(--qa-label-x·y)가 먼저이고, 방향 규칙은 값이 없을 때의 기본값이다.
    dx: "var(--qa-label-x, calc(-50% + clamp(-50%, var(--qa-x, 0px) * 1000, 50%)))",
    above: "calc(-1 * var(--qa-label-gap) - 100%)",
    side: "calc(var(--qa-label-gap) + clamp(calc(-2 * var(--qa-label-gap) - 100%), var(--qa-y, 0px) * 1000, 0px))",
    flip: "clamp(0px, calc((4px - var(--qa-label-cy) - var(--qa-label-above)) * 1000), calc(2 * var(--qa-label-gap) + 100%))",
    dy: "var(--qa-label-y, max(var(--qa-label-side), calc(var(--qa-label-above) + var(--qa-label-flip))))",
  });
  const shift = label.match(/transform:\s*translate\(([\s\S]+)\);/)?.[1].replace(/\s+/g, " ").trim();
  assert.equal(shift,
    "clamp(calc(4px - var(--qa-label-cx)), var(--qa-label-dx), calc(100vw - 4px - var(--qa-label-cx) - 100%)), "
      + "clamp(calc(4px - var(--qa-label-cy)), var(--qa-label-dy), calc(100dvh - 4px - var(--qa-label-cy) - 100%))",
    "라벨은 방향에 맞는 자리에 두고 화면 네 변 4px 안으로 막는다");

  // 위 선언을 그대로 옮긴 계산이다. CSS clamp(a, b, c)는 max(a, min(b, c))이고 %는 라벨 자신의 너비·높이다.
  const clamp = (low, value, high) => Math.max(low, Math.min(value, high));
  const labelBox = ({ cx, cy, qx, qy, w, h, vw, vh, lx, ly }) => {
    const gap = size / 2 + 4;
    const dx = lx ?? -w / 2 + clamp(-w / 2, qx * 1000, w / 2);
    const above = -gap - h;
    const side = gap + clamp(-2 * gap - h, qy * 1000, 0);
    const flip = clamp(0, (4 - cy - above) * 1000, 2 * gap + h);
    const dy = ly ?? Math.max(side, above + flip);
    const left = cx + clamp(4 - cx, dx, vw - 4 - cx - w);
    const top = cy + clamp(4 - cy, dy, vh - 4 - cy - h);
    return { left, top, right: left + w, bottom: top + h };
  };
  const ringLabels = ({ ox, oy, radius, angles, widths, vw, vh }) => angles.map((angle, index) => {
    const qx = radius * Math.cos((angle * Math.PI) / 180);
    const qy = -radius * Math.sin((angle * Math.PI) / 180);
    return labelBox({ cx: ox + qx, cy: oy + qy, qx, qy, w: widths[index], h: 22, vw, vh });
  });
  // 라벨 너비는 13px 굵은 글자 폭과 좌우 여백으로 어림했다(영어가 한국어보다 넓다).
  const widths = { en: [78, 93, 108, 101], ko: [70, 74, 92, 86] };
  const scenarios = [
    // 검토 재현: 320px 낮은 화면, 왼쪽 + 중심 (50, 150), 버블 4개가 90°→0° 호. 예전에는 두 라벨이 모두 y=4px.
    ["낮은 화면 왼쪽 +", { ox: 50, oy: 150, radius: 120, angles: [90, 60, 30, 0], vw: 320, vh: 568 }],
    ["넓은 반원", { ox: 160, oy: 400, radius: 96, angles: [180, 120, 60, 0], vw: 320, vh: 640 }],
    ["낮은 화면 오른쪽 +", { ox: 270, oy: 150, radius: 120, angles: [180, 150, 120, 90], vw: 320, vh: 568 }],
  ];
  for (const [name, scenario] of scenarios) {
    for (const [lang, list] of Object.entries(widths)) {
      const boxes = ringLabels({ ...scenario, widths: list });
      // 삼각함수 좌표의 부동소수 오차(1e-13px 수준)는 화면 경계·겹침 판정에서 무시한다.
      const eps = 1e-6;
      for (const [index, box] of boxes.entries()) {
        assert.ok(box.left >= 4 - eps && box.right <= scenario.vw - 4 + eps
          && box.top >= 4 - eps && box.bottom <= scenario.vh - 4 + eps,
        `${name} ${lang} 라벨 ${index + 1} 화면 안: ${JSON.stringify(box)}`);
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const [a, b] = [boxes[i], boxes[j]];
          const apart = a.right <= b.left + eps || b.right <= a.left + eps
            || a.bottom <= b.top + eps || b.bottom <= a.top + eps;
          assert.ok(apart, `${name} ${lang} 라벨 ${i + 1}·${j + 1}이 겹친다: ${JSON.stringify([a, b])}`);
        }
      }
    }
  }
  // 배치 함수가 라벨 자리를 넘기면 방향 규칙 대신 그 값을 쓰고, 화면 안이면 그대로 둔다.
  // 예: 버블이 한 줄로 놓인 320×180 화면에서 배치 함수가 라벨을 위·아래 두 줄로 나눈 경우.
  assert.deepEqual(labelBox({ cx: 170, cy: 85, qx: 120, qy: 0, w: 93, h: 22, vw: 320, vh: 180, lx: -46.5, ly: -50 }),
    { left: 123.5, top: 35, right: 216.5, bottom: 57 });
  // 넘긴 자리가 화면 밖이면 화면 네 변 4px 안으로만 막는다.
  assert.deepEqual(labelBox({ cx: 290, cy: 85, qx: 240, qy: 0, w: 101, h: 22, vw: 320, vh: 180, lx: -50.5, ly: 28 }),
    { left: 215, top: 113, right: 316, bottom: 135 });
  // 위쪽 공간이 넉넉한 맨 위 버블 라벨은 버블 위 4px 가운데 정렬 그대로다.
  assert.deepEqual(labelBox({ cx: 160, cy: 300, qx: 0, qy: -100, w: 70, h: 22, vw: 320, vh: 640 }),
    { left: 125, top: 250, right: 195, bottom: 272 });
  assert.match(css, /html\[data-theme="neumorphic"\] \.qa-label\s*\{\s*box-shadow:\s*var\(--shadow-raised\)/);

  // 라벨·아이콘·경계 대비를 라이트·명시 다크·시스템 다크 모두에서 확인한다.
  const ink = label.match(/color:\s*(var\(--[\w-]+\))/)?.[1];
  const face = label.match(/background:\s*(var\(--[\w-]+\))/)?.[1];
  for (const [mode, resolve] of palettes()) {
    assertContrast(resolve(ink), resolve(face), 4.5, `${mode} label`);
    assertContrast(resolve("var(--color-on-accent)"), resolve("var(--color-school-blue)"), 4.5, `${mode} icon on blob`);
    for (const back of ["var(--color-paper)", "var(--color-surface)", "var(--surface-card)"]) {
      assertContrast(resolve("var(--color-school-blue)"), resolve(back), 3, `${mode} blob on ${back}`);
      assertContrast(resolve("var(--color-control-border)"), resolve(back), 3, `${mode} bubble edge on ${back}`);
    }
  }
});

// 빠른 실행 링의 동작 모듈(quick-actions.mjs)은 다른 작업이 만든다. 결합된 체크아웃에서만 이 스타일과의 계약을 검사한다.
function integratedQuickActions(t) {
  const url = new URL("../web/assets/quick-actions.mjs", import.meta.url);
  if (existsSync(url)) return readFileSync(url, "utf8");
  t.skip("빠른 실행 링 동작 모듈이 아직 이 체크아웃에 합쳐지지 않았음");
  return null;
}

// 아래 두 검사는 동작 작업의 파일(quick-actions.mjs·sw.js)을 본다. 이 스타일 작업은 그 파일을 고칠 수 없으므로
// 결함이 남아 있는 동안 통합 검증을 막지 않도록 todo로 두고, 실행 출력에 미해결 항목으로 남긴다.
// 동작 작업이 라벨 좌표 전달과 셸 캐시 v11을 반영하면 todo를 걷어 필수 검사로 바꾼다.
const QA_TODO_LABELS = "동작 작업 몫: quick-actions.mjs 배치 함수가 --qa-label-x·y를 넘겨야 함(320×180 한 줄 배치)";
const QA_TODO_CACHE = "동작 작업 몫: #29가 v10으로 먼저 배포됐으므로 sw.js 셸 캐시를 v11로 올려야 함";

test("통합 빠른 실행 링: 배치 함수가 라벨 자리를 .qa-item에 넘긴다", { todo: QA_TODO_LABELS }, (t) => {
  const source = integratedQuickActions(t);
  if (source === null) return;
  // CSS 기본 라벨 규칙은 호 배치용이다. 320×180 화면처럼 버블이 한 줄로 놓이면 라벨 줄은 배치 함수만 나눌 수 있으므로,
  // 결합본은 라벨 좌표를 실제로 넘겨야 한다(좌표를 직접 넣는 스타일 테스트로는 전달 누락을 잡지 못한다).
  for (const name of ["--qa-label-x", "--qa-label-y"]) {
    assert.match(source, new RegExp(`setProperty\\(\\s*["'\`]${name}["'\`]`), `${name}를 넘긴다`);
  }
});

test("통합 빠른 실행 링: 링 스타일을 담은 셸은 #29가 쓴 v10보다 새 캐시 판이다", { todo: QA_TODO_CACHE }, (t) => {
  const source = integratedQuickActions(t);
  if (source === null) return;
  // #29가 aio-shell-v10으로 먼저 배포됐다. 같은 판이면 설치된 PWA가 이전 index.html·app.css를 계속 내준다.
  const worker = readFileSync(new URL("../web/sw.js", import.meta.url), "utf8");
  const version = Number(worker.match(/CACHE_NAME\s*=\s*`\$\{CACHE_PREFIX\}v(\d+)`/)?.[1]);
  assert.ok(version >= 11, `셸 캐시 판 v${version}`);
});

test("빠른 실행 링: 전환은 300ms 미만 ease-out이고 움직임 줄이기에서 꺼진다", () => {
  const { block, rule } = qaCss();
  const durations = [...block.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map(([, n, unit]) => Number(n) * (unit === "s" ? 1000 : 1));
  assert.ok(durations.length >= 2, "링 전환 시간");
  for (const ms of durations) assert.ok(ms > 0 && ms < 300, `${ms}ms`);

  const ease = rule(".qa-ring").match(/--qa-ease:\s*cubic-bezier\(([^)]+)\)/)?.[1].split(",").map(Number);
  assert.ok(ease?.length === 4, "--qa-ease");
  const [x1, y1, , y2] = ease;
  assert.ok(x1 < y1 && y2 === 1, "처음이 빠르고 끝이 느린 ease-out 곡선");
  for (const [, timing] of block.matchAll(/transition:\s*([^;]+);/g)) {
    if (timing.trim() === "none") continue;
    for (const part of timing.split(",")) assert.match(part, /var\(--qa-ease\)|ease-out/, part);
  }

  const reduced = [...block.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map(([, body]) => body).join("\n");
  assert.match(reduced, /\.qa-goo,\s*\.qa-blob,\s*\.qa-item\s*\{\s*transition:\s*none;/);
});

test("음각양각은 카드와 탭에 볼록한 그림자, 입력과 선택 상태에 오목한 그림자를 준다", () => {
  const css = read("assets/app.css");
  const effect = css.match(/html\[data-theme="neumorphic"\]\s*\{([^{}]*)\}/)?.[1] ?? "";
  assert.match(effect, /--border-card:\s*1px solid var\(--color-control-border\)/);
  assert.match(effect, /--shadow-card:\s*var\(--shadow-raised\)/);
  assert.match(effect, /--shadow-input:\s*var\(--shadow-recessed\)/);
  assert.match(css, /html\[data-theme="neumorphic"\] \.tab-bar\s*\{\s*box-shadow:\s*var\(--shadow-raised\)/);
  assert.match(css, /\.mode-button\[aria-pressed="true"\],\s*\.appearance-option:has\(input:checked\)\s*\)\s*\{\s*box-shadow:\s*var\(--shadow-recessed\)/);
});
