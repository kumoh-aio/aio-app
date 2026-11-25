// APK의 versionCode·versionName을 빌드 종류에 맞춰 정한다.
// - refs/tags/v<주>.<부>.<수> 태그: versionName은 v를 뗀 값. 다른 v* 태그는 오류.
// - 그 밖의 빌드: versionName은 0.0.<run_number>-debug.
// - versionCode는 언제나 run_number.
// 직접 실행: node tools/android-version.mjs <build.gradle> <github.ref> <run_number>
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const TAG_PREFIX = "refs/tags/";
// Google Play가 받는 versionCode 상한.
const MAX_VERSION_CODE = 2100000000;

function parseRunNumber(runNumber) {
  const text = String(runNumber ?? "").trim();
  if (!/^[1-9]\d*$/.test(text) || Number(text) > MAX_VERSION_CODE) {
    throw new Error(`run_number must be a positive integer up to ${MAX_VERSION_CODE}: ${JSON.stringify(runNumber)}`);
  }
  return Number(text);
}

export function resolveVersion({ ref, runNumber } = {}) {
  const code = parseRunNumber(runNumber);
  const value = String(ref ?? "");
  if (value.startsWith(`${TAG_PREFIX}v`)) {
    const tag = value.slice(TAG_PREFIX.length);
    if (!RELEASE_TAG.test(tag)) {
      throw new Error(`Release tag must look like v1.2.3 (no leading zeros or suffix): ${tag}`);
    }
    return { code, name: tag.slice(1) };
  }
  return { code, name: `0.0.${code}-debug` };
}

const IDENT = /[A-Za-z_$][\w$]*/y;
const NUMBER = /\d[\w.]*/y;

// build.gradle(Groovy)을 선언 판정에 필요한 만큼만 토큰으로 나눈다.
// - 주석은 버리고, 여러 줄 주석은 줄바꿈 하나로 본다.
// - '…', "…", '''…''', """…"""는 문자열 토큰 하나다. "${…}" 안은 다시 나눠 이름만 따로 모은다.
// - 해석할 수 없는 문법($/…/$, 닫히지 않은 문자열·주석)은 추측하지 않고 실패한다.
export function tokenizeGradle(source, start = 0, untilBrace = false) {
  const tokens = [];
  const nested = [];
  let depth = 0;
  let i = start;
  const fail = (what) => { throw new Error(`Unsupported or malformed Gradle syntax at offset ${i}: ${what}`); };
  const push = (type, from, to, extra = {}) => tokens.push({ type, start: from, end: to, text: source.slice(from, to), ...extra });

  const readString = () => {
    const quote = source[i];
    const triple = source.startsWith(quote.repeat(3), i);
    let j = i + (triple ? 3 : 1);
    let interpolated = false;
    for (;;) {
      if (j >= source.length) fail("unterminated string");
      const char = source[j];
      if (char === "\\") { j += 2; continue; }
      if (triple ? source.startsWith(quote.repeat(3), j) : char === quote) break;
      if (!triple && (char === "\n" || char === "\r")) fail("line break in a single-line string");
      if (quote === '"' && char === "$") {
        interpolated = true;
        if (source[j + 1] === "{") {
          const inner = tokenizeGradle(source, j + 2, true);
          nested.push(...inner.tokens.filter((token) => token.type === "ident"), ...inner.nested);
          j = inner.end + 1;
          continue;
        }
      }
      j += 1;
    }
    const end = j + (triple ? 3 : 1);
    push("string", i, end, { triple, interpolated });
    i = end;
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === " " || char === "\t" || char === "\f") { i += 1; continue; }
    if (char === "\\" && (next === "\n" || next === "\r")) { i += next === "\r" && source[i + 2] === "\n" ? 3 : 2; continue; }
    if (char === "\n" || char === "\r") {
      const end = char === "\r" && next === "\n" ? i + 2 : i + 1;
      push("newline", i, end);
      i = end;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const close = source.indexOf("*/", i + 2);
      if (close < 0) fail("unterminated comment");
      if (/[\r\n]/.test(source.slice(i, close))) push("newline", i, close + 2);
      i = close + 2;
      continue;
    }
    if (char === "$" && next === "/") fail("dollar-slashy string");
    if (char === "'" || char === '"') { readString(); continue; }
    if (untilBrace && char === "}" && depth === 0) return { tokens, nested, end: i };
    let match;
    if ((IDENT.lastIndex = i, match = IDENT.exec(source))) { push("ident", i, i + match[0].length); i += match[0].length; continue; }
    if ((NUMBER.lastIndex = i, match = NUMBER.exec(source))) { push("number", i, i + match[0].length); i += match[0].length; continue; }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    push("punct", i, i + 1);
    i += 1;
  }
  if (untilBrace) fail("unterminated ${ } expression");
  return { tokens, nested, end: i };
}

const STATEMENT_START = (token) => !token || token.type === "newline" || token.text === "{" || token.text === ";";
const STATEMENT_END = (token) => !token || token.type === "newline" || token.text === ";" || token.text === "}";
const LITERAL = {
  versionCode: (token) => token?.type === "number" && /^\d+$/.test(token.text),
  versionName: (token) => token?.type === "string" && !token.triple && !token.interpolated,
};

// 이름이 코드에 딱 한 번 나오고, 그 자리가 `이름 [=] 리터럴` 한 문장일 때만 값 토큰을 돌려준다.
function findDeclaration({ tokens, nested }, key) {
  const at = tokens.flatMap((token, index) => (token.type === "ident" && token.text === key ? [index] : []));
  const count = at.length + nested.filter((token) => token.text === key).length;
  const reject = () => {
    throw new Error(`Expected exactly one ${key} declaration with a literal value, found ${count} mention(s)`);
  };
  if (count !== 1 || at.length !== 1) reject();
  let index = at[0];
  if (!STATEMENT_START(tokens[index - 1])) reject();
  index += 1;
  if (tokens[index]?.text === "=") index += 1;
  if (!LITERAL[key](tokens[index]) || !STATEMENT_END(tokens[index + 1])) reject();
  return tokens[index];
}

export function applyVersion(gradleSource, { code, name } = {}) {
  if (typeof gradleSource !== "string") throw new TypeError("gradleSource must be a string");
  if (!Number.isInteger(code) || code < 1 || code > MAX_VERSION_CODE) throw new Error(`Invalid versionCode: ${code}`);
  if (typeof name !== "string" || !/^\d+\.\d+\.\d+(-debug)?$/.test(name)) throw new Error(`Invalid versionName: ${name}`);
  const lexed = tokenizeGradle(gradleSource);
  const edits = [
    { ...findDeclaration(lexed, "versionCode"), value: String(code) },
    { ...findDeclaration(lexed, "versionName"), value: `"${name}"` },
  ].sort((a, b) => b.start - a.start);
  let result = gradleSource;
  for (const { start, end, value } of edits) result = result.slice(0, start) + value + result.slice(end);
  return result;
}

function main([file, ref, runNumber]) {
  if (!file) throw new Error("Usage: node tools/android-version.mjs <build.gradle> <github.ref> <run_number>");
  const version = resolveVersion({ ref, runNumber });
  writeFileSync(file, applyVersion(readFileSync(file, "utf8"), version));
  console.log(`versionCode ${version.code}, versionName ${version.name}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
