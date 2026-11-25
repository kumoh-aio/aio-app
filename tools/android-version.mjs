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

const CODE_LINE = /^([ \t]*versionCode[ \t]+)\d+([ \t]*)$/m;
const NAME_LINE = /^([ \t]*versionName[ \t]+)"[^"\r\n]*"([ \t]*)$/m;
const countDeclarations = (source, key) => (source.match(new RegExp(`^[ \\t]*${key}\\b`, "gm")) ?? []).length;

export function applyVersion(gradleSource, { code, name } = {}) {
  if (typeof gradleSource !== "string") throw new TypeError("gradleSource must be a string");
  if (!Number.isInteger(code) || code < 1 || code > MAX_VERSION_CODE) throw new Error(`Invalid versionCode: ${code}`);
  if (typeof name !== "string" || !/^\d+\.\d+\.\d+(-debug)?$/.test(name)) throw new Error(`Invalid versionName: ${name}`);
  for (const [key, line] of [["versionCode", CODE_LINE], ["versionName", NAME_LINE]]) {
    const count = countDeclarations(gradleSource, key);
    if (count !== 1 || !line.test(gradleSource)) {
      throw new Error(`Expected exactly one ${key} declaration, found ${count}`);
    }
  }
  return gradleSource
    .replace(CODE_LINE, (_, head, tail) => `${head}${code}${tail}`)
    .replace(NAME_LINE, (_, head, tail) => `${head}"${name}"${tail}`);
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
