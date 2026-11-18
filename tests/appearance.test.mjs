import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(rule(".calendar-week"), /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(rule(".calendar-bars"), /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(rule(".calendar-bars"), /pointer-events:\s*none/, "막대는 칸 누르기를 막지 않는다");
  assert.match(rule(".calendar-day.is-weekend"), /background:\s*var\(--color-cal-weekend\)/);
  assert.match(rule(".calendar-day.is-outside"), /color:\s*var\(--color-text-muted\)/);
  assert.match(css, /\.calendar-day\.is-today > [^{]+\{[^}]*background:\s*var\(--color-school-blue\);[^}]*color:\s*var\(--color-on-accent\)/);
  assert.match(rule(".calendar-day.is-selected"), /box-shadow:\s*inset 0 0 0 2px var\(--color-school-blue\)/);
  assert.match(css, /\.calendar-viewswitch button,\s*\.calendar-nav button \{[^}]*min-width:\s*var\(--touch\);\s*min-height:\s*var\(--touch\)/);
  for (const name of ["enroll", "exam", "holiday", "register", "other"]) {
    assert.match(css, new RegExp(`\\.calendar-cat-${name} \\{ --cal-bg: var\\(--color-cal-${name}-bg\\); --cal-ink: var\\(--color-cal-${name}-ink\\); \\}`));
  }
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

test("음각양각은 카드와 탭에 볼록한 그림자, 입력과 선택 상태에 오목한 그림자를 준다", () => {
  const css = read("assets/app.css");
  const effect = css.match(/html\[data-theme="neumorphic"\]\s*\{([^{}]*)\}/)?.[1] ?? "";
  assert.match(effect, /--border-card:\s*1px solid var\(--color-control-border\)/);
  assert.match(effect, /--shadow-card:\s*var\(--shadow-raised\)/);
  assert.match(effect, /--shadow-input:\s*var\(--shadow-recessed\)/);
  assert.match(css, /html\[data-theme="neumorphic"\] \.tab-bar\s*\{\s*box-shadow:\s*var\(--shadow-raised\)/);
  assert.match(css, /\.mode-button\[aria-pressed="true"\],\s*\.appearance-option:has\(input:checked\)\s*\)\s*\{\s*box-shadow:\s*var\(--shadow-recessed\)/);
});
