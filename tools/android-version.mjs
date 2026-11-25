// APK의 versionCode·versionName을 빌드 종류에 맞춰 정하고, 빌드한 APK에 들어갔는지 확인한다.
// - refs/tags/v<주>.<부>.<수> 태그: versionName은 v를 뗀 값. 다른 v* 태그는 오류.
// - 그 밖의 빌드: versionName은 0.0.<run_number>-debug.
// - versionCode는 언제나 run_number.
// 직접 실행:
//   node tools/android-version.mjs <build.gradle> <github.ref> <run_number>
//   aapt2 dump badging <apk> | node tools/android-version.mjs verify - <github.ref> <run_number>
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

function assertVersion({ code, name } = {}) {
  if (!Number.isInteger(code) || code < 1 || code > MAX_VERSION_CODE) throw new Error(`Invalid versionCode: ${code}`);
  if (typeof name !== "string" || !/^\d+\.\d+\.\d+(-debug)?$/.test(name)) throw new Error(`Invalid versionName: ${name}`);
}

// Capacitor가 만드는 build.gradle의 모양만 받는다.
//   <들여쓰기>defaultConfig {
//   <들여쓰기>    versionCode <숫자>
//   <들여쓰기>    versionName "<값>"
//   <들여쓰기>}
// 다른 모양은 Groovy를 해석하지 않고 실패한다. 블록 밖은 읽지도 바꾸지도 않는다.
const DEFAULT_CONFIG_OPEN = /^([ \t]*)defaultConfig[ \t]*\{[ \t]*\r?$/;
const UNSUPPORTED_IN_BLOCK = /\/\*|'''|"""/;
const LINES = {
  versionCode: /^([ \t]*versionCode[ \t]+)\d+([ \t]*\r?)$/,
  versionName: /^([ \t]*versionName[ \t]+)"[^"\\$\r\n]*"([ \t]*\r?)$/,
};
const LITERAL_SHAPE = { versionCode: "<number>", versionName: '"<value>"' };

function findDefaultConfig(lines) {
  const opens = lines.flatMap((line, index) => (DEFAULT_CONFIG_OPEN.test(line) ? [index] : []));
  if (opens.length !== 1) throw new Error(`Expected exactly one "defaultConfig {" line, found ${opens.length}`);
  const [open] = opens;
  const indent = DEFAULT_CONFIG_OPEN.exec(lines[open])[1];
  const close = new RegExp(`^${indent}\\}[ \\t]*\\r?$`);
  const end = lines.findIndex((line, index) => index > open && close.test(line));
  if (end < 0) throw new Error("defaultConfig block has no closing brace at the same indentation");
  const body = lines.slice(open + 1, end).join("\n");
  if (UNSUPPORTED_IN_BLOCK.test(body)) throw new Error("defaultConfig block uses /* */ comments or triple-quoted strings");
  return { start: open + 1, end };
}

function findLine(lines, { start, end }, key) {
  const mention = new RegExp(`\\b${key}\\b`);
  const found = [];
  for (let index = start; index < end; index += 1) {
    if (!lines[index].trimStart().startsWith("//") && mention.test(lines[index])) found.push(index);
  }
  if (found.length !== 1 || !LINES[key].test(lines[found[0]])) {
    throw new Error(`Expected exactly one ${key} ${LITERAL_SHAPE[key]} line in defaultConfig, found ${found.length} mention(s)`);
  }
  return found[0];
}

export function applyVersion(gradleSource, version = {}) {
  if (typeof gradleSource !== "string") throw new TypeError("gradleSource must be a string");
  assertVersion(version);
  const lines = gradleSource.split("\n");
  const block = findDefaultConfig(lines);
  const codeLine = findLine(lines, block, "versionCode");
  const nameLine = findLine(lines, block, "versionName");
  lines[codeLine] = lines[codeLine].replace(LINES.versionCode, (_, head, tail) => `${head}${version.code}${tail}`);
  lines[nameLine] = lines[nameLine].replace(LINES.versionName, (_, head, tail) => `${head}"${version.name}"${tail}`);
  return lines.join("\n");
}

// `aapt2 dump badging` 출력의 package 줄에서 두 값을 읽어 기대값과 비교한다.
export function checkBadging(output, version = {}) {
  assertVersion(version);
  const lines = String(output ?? "").split(/\r?\n/).filter((line) => line.startsWith("package:"));
  if (lines.length !== 1) throw new Error(`aapt2 output must have one package line, found ${lines.length}`);
  const read = (key) => new RegExp(`\\s${key}='([^']*)'`).exec(lines[0])?.[1];
  const actual = { code: read("versionCode"), name: read("versionName") };
  if (actual.code !== String(version.code) || actual.name !== version.name) {
    throw new Error(`APK has versionCode ${actual.code} and versionName ${actual.name}, `
      + `expected ${version.code} and ${version.name}`);
  }
  return { code: version.code, name: version.name };
}

function main(args) {
  if (args[0] === "verify") {
    const [, input, ref, runNumber] = args;
    if (!input) throw new Error("Usage: aapt2 dump badging <apk> | node tools/android-version.mjs verify - <github.ref> <run_number>");
    const version = resolveVersion({ ref, runNumber });
    checkBadging(readFileSync(input === "-" ? 0 : input, "utf8"), version);
    console.log(`APK matches versionCode ${version.code}, versionName ${version.name}`);
    return;
  }
  const [file, ref, runNumber] = args;
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
