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

// 주석(//, /* */)과 문자열 안쪽을 공백으로 바꾼 같은 길이의 사본을 만든다.
// 줄바꿈과 따옴표는 남겨 원본과 위치가 그대로 맞는다.
export function maskGradle(source) {
  const out = source.split("");
  let state = "code";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    const blank = (at) => { if (at < out.length && out[at] !== "\n" && out[at] !== "\r") out[at] = " "; };
    if (state === "code") {
      if (char === "/" && next === "/") { state = "line"; blank(i); }
      else if (char === "/" && next === "*") { state = "block"; blank(i); blank(i + 1); i += 1; }
      else if (char === '"' || char === "'") state = char;
    } else if (state === "line") {
      if (char === "\n" || char === "\r") state = "code"; else blank(i);
    } else if (state === "block") {
      blank(i);
      if (char === "*" && next === "/") { blank(i + 1); i += 1; state = "code"; }
    } else if (char === "\\") {
      blank(i); blank(i + 1); i += 1;
    } else if (char === state) {
      state = "code";
    } else if (char === "\n" || char === "\r") {
      state = "code";
    } else {
      blank(i);
    }
  }
  return out.join("");
}

// 가린 사본에서 찾는 선언 줄 모양과, 같은 위치의 원본에서 확인할 모양.
const DECLARATIONS = {
  versionCode: { masked: /^[ \t]*versionCode[ \t]+\d+[ \t]*$/m, original: /([ \t]*versionCode[ \t]+)\d+/y },
  versionName: { masked: /^[ \t]*versionName[ \t]+"[ ]*"[ \t]*$/m, original: /([ \t]*versionName[ \t]+)"[^"\r\n\\]*"/y },
};

function findDeclaration(source, masked, key) {
  const count = (masked.match(new RegExp(`\\b${key}\\b`, "g")) ?? []).length;
  const line = count === 1 ? DECLARATIONS[key].masked.exec(masked) : null;
  const original = DECLARATIONS[key].original;
  if (line) original.lastIndex = line.index;
  const match = line && original.exec(source);
  if (!match) throw new Error(`Expected exactly one ${key} declaration, found ${count}`);
  return { start: match.index, end: match.index + match[0].length, head: match[1] };
}

export function applyVersion(gradleSource, { code, name } = {}) {
  if (typeof gradleSource !== "string") throw new TypeError("gradleSource must be a string");
  if (!Number.isInteger(code) || code < 1 || code > MAX_VERSION_CODE) throw new Error(`Invalid versionCode: ${code}`);
  if (typeof name !== "string" || !/^\d+\.\d+\.\d+(-debug)?$/.test(name)) throw new Error(`Invalid versionName: ${name}`);
  const masked = maskGradle(gradleSource);
  const edits = [
    { ...findDeclaration(gradleSource, masked, "versionCode"), value: String(code) },
    { ...findDeclaration(gradleSource, masked, "versionName"), value: `"${name}"` },
  ].sort((a, b) => b.start - a.start);
  let result = gradleSource;
  for (const { start, end, head, value } of edits) result = result.slice(0, start) + head + value + result.slice(end);
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
