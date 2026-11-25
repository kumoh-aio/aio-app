import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { RELEASE_TAG, applyVersion, checkBadging, resolveVersion } from "../tools/android-version.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Capacitor가 만드는 build.gradle의 defaultConfig를 흉내 낸 가상 문자열.
const gradle = `android {
    namespace "kr.example.aio"
    defaultConfig {
        applicationId "kr.example.aio"
        minSdkVersion rootProject.ext.minSdkVersion
        versionCode 1
        versionName "1.0"
        // versionCode 와 versionName 은 CI가 바꾼다.
    }
}
`;

test("release tags v<major>.<minor>.<patch> drop the v and keep run_number as versionCode", () => {
  assert.deepEqual(resolveVersion({ ref: "refs/tags/v1.0.0", runNumber: "42" }), { code: 42, name: "1.0.0" });
  assert.deepEqual(resolveVersion({ ref: "refs/tags/v0.10.3", runNumber: 7 }), { code: 7, name: "0.10.3" });
  assert.deepEqual(resolveVersion({ ref: "refs/tags/v12.0.99", runNumber: "1" }), { code: 1, name: "12.0.99" });
});

test("malformed v* tags fail instead of producing a release name", () => {
  for (const tag of ["v1.2", "v01.2.3", "v1.02.3", "v1.2.03", "v1.2.3-rc.1", "v1.2.3.4", "v", "vx.y.z", "v1.2.3 "]) {
    assert.throws(() => resolveVersion({ ref: `refs/tags/${tag}`, runNumber: "5" }), /Release tag/, tag);
    assert.equal(RELEASE_TAG.test(tag), false, tag);
  }
});

test("branch, pull request and non-v builds use 0.0.<run_number>-debug", () => {
  for (const ref of ["refs/heads/main", "refs/pull/12/merge", "refs/tags/release-1", "refs/heads/v1.2.3", ""]) {
    assert.deepEqual(resolveVersion({ ref, runNumber: "93" }), { code: 93, name: "0.0.93-debug" }, ref);
  }
});

test("run_number must be a positive integer", () => {
  for (const runNumber of [undefined, "", "0", "-1", "1.5", "abc", "007", "2100000001"]) {
    assert.throws(() => resolveVersion({ ref: "refs/heads/main", runNumber }), /run_number/, String(runNumber));
  }
});

test("applyVersion replaces the single versionCode and versionName in fake Gradle source", () => {
  const out = applyVersion(gradle, { code: 42, name: "1.2.3" });
  assert.match(out, /^ {8}versionCode 42$/m);
  assert.match(out, /^ {8}versionName "1\.2\.3"$/m);
  assert.equal(out.replace("versionCode 42", "versionCode 1").replace('"1.2.3"', '"1.0"'), gradle);
  const debug = applyVersion(gradle.replaceAll("\n", "\r\n"), { code: 9, name: "0.0.9-debug" });
  assert.match(debug, /versionCode 9\r\n/);
  assert.match(debug, /versionName "0\.0\.9-debug"\r\n/);
});

test("applyVersion fails when a declaration is missing, repeated or not a plain literal", () => {
  const version = { code: 3, name: "0.0.3-debug" };
  const cases = {
    "no versionCode": gradle.replace(/^.*versionCode 1\n/m, ""),
    "no versionName": gradle.replace(/^.*versionName "1\.0"\n/m, ""),
    "two versionCode": gradle.replace("versionCode 1\n", "versionCode 1\n        versionCode 2\n"),
    "two versionName": gradle.replace('versionName "1.0"\n', 'versionName "1.0"\n        versionName "2.0"\n'),
    "computed versionCode": gradle.replace("versionCode 1", "versionCode rootProject.ext.code"),
    "computed versionName": gradle.replace('versionName "1.0"', "versionName rootProject.ext.name"),
  };
  for (const [label, source] of Object.entries(cases)) {
    assert.throws(() => applyVersion(source, version), /Expected exactly one version(Code|Name)/, label);
  }
});

test("only the defaultConfig block lines are read; full-line comments inside are skipped", () => {
  const version = { code: 3, name: "0.0.3-debug" };
  // 블록 밖의 주석·문자열·다른 블록은 읽지도 바꾸지도 않는다.
  const outside = `/* versionCode 7 */\n${gradle}`
    + "def notes = '''\nversionCode 5\nversionName \"9.9\"\n'''\n"
    + "productFlavors { demo { versionName 'demo' } }\n😀\n";
  const out = applyVersion(outside.replace("        minSdkVersion", "        // versionName 2\n        minSdkVersion"), version);
  assert.match(out, /^ {8}versionCode 3$/m);
  assert.match(out, /^ {8}versionName "0\.0\.3-debug"$/m);
  assert.ok(out.startsWith("/* versionCode 7 */\n"));
  assert.ok(out.endsWith("def notes = '''\nversionCode 5\nversionName \"9.9\"\n'''\n"
    + "productFlavors { demo { versionName 'demo' } }\n😀\n"));
  assert.match(out, /^ {8}\/\/ versionName 2$/m);
});

test("defaultConfig shapes other than the Capacitor template fail instead of guessing", () => {
  const version = { code: 42, name: "1.2.3" };
  const expectLine = /Expected exactly one version(Code|Name) .* line in defaultConfig/;
  const lineCases = {
    // 이전 리뷰 재현: 같은 줄 중복, 한 줄 주석으로 지운 선언, 문자열 속 이름, 보간 값
    "same-line duplicate": gradle.replace("minSdkVersion rootProject.ext.minSdkVersion", "minSdkVersion 23; versionCode 9"),
    "line-commented": gradle.replace("        versionCode 1", "        // versionCode 1"),
    "quoted only": gradle.replace('applicationId "kr.example.aio"', 'applicationId "versionCode 5"')
      .replace("        versionCode 1\n", ""),
    "trailing comment": gradle.replace("versionCode 1", "versionCode 1 // build"),
    "assignment": gradle.replace("versionCode 1", "versionCode = 1"),
    "single quotes": gradle.replace('versionName "1.0"', "versionName '1.0'"),
    "interpolated name": gradle.replace('versionName "1.0"', 'versionName "v$suffix"'),
    "expression": gradle.replace("versionCode 1", "versionCode 1 + 1"),
  };
  for (const [label, source] of Object.entries(lineCases)) {
    assert.throws(() => applyVersion(source, version), expectLine, label);
  }
  const blockCases = {
    // 이전 리뷰 재현: 블록 주석으로 감싼 선언, 세 겹 따옴표 속 선언
    "block comment": gradle.replace("        versionCode 1\n", "        /*\n        versionCode 1\n")
      .replace('        versionName "1.0"\n', '        versionName "1.0"\n        */\n'),
    "inline block comment": gradle.replace("versionCode 1", "/* old */ versionCode 1"),
    "triple single": gradle.replace("        minSdkVersion", "        def a = '''\n        versionCode 5\n'''\n        minSdkVersion"),
    "triple double": gradle.replace("        minSdkVersion", '        def a = """x"""\n        minSdkVersion'),
  };
  for (const [label, source] of Object.entries(blockCases)) {
    assert.throws(() => applyVersion(source, version), /defaultConfig block uses/, label);
  }
  const structureCases = {
    "no defaultConfig": "def sample = '''\nversionCode 1\nversionName \"1.0\"\n'''\n",
    "one-line block": 'android { defaultConfig { versionCode 1; versionName "1.0" } }',
    "two blocks": gradle + gradle,
  };
  for (const [label, source] of Object.entries(structureCases)) {
    assert.throws(() => applyVersion(source, version), /Expected exactly one "defaultConfig \{" line/, label);
  }
  assert.throws(() => applyVersion(gradle.replace("    }\n}", "}"), version), /no closing brace/);
});

test("checkBadging compares aapt2 package versions with the expected values", () => {
  const badging = (code, name) => `package: name='kr.example.aio' versionCode='${code}' versionName='${name}' `
    + "platformBuildVersionName='15' compileSdkVersion='35'\nsdkVersion:'24'\napplication-label:'아이오'\n";
  assert.deepEqual(checkBadging(badging(42, "1.2.3"), { code: 42, name: "1.2.3" }), { code: 42, name: "1.2.3" });
  assert.deepEqual(checkBadging(badging(9, "0.0.9-debug").replaceAll("\n", "\r\n"), { code: 9, name: "0.0.9-debug" }),
    { code: 9, name: "0.0.9-debug" });
  assert.throws(() => checkBadging(badging(41, "1.2.3"), { code: 42, name: "1.2.3" }), /APK has versionCode 41/);
  assert.throws(() => checkBadging(badging(42, "1.0"), { code: 42, name: "1.2.3" }), /versionName 1\.0, expected/);
  assert.throws(() => checkBadging("sdkVersion:'24'\n", { code: 1, name: "1.0.0" }), /one package line, found 0/);
  assert.throws(() => checkBadging("package: name='x'\n", { code: 1, name: "1.0.0" }), /APK has versionCode undefined/);
  assert.throws(() => checkBadging(badging(1, "1.0.0") + badging(1, "1.0.0"), { code: 1, name: "1.0.0" }), /found 2/);
});

test("applyVersion rejects values that would break the Gradle literal", () => {
  for (const name of ['1.0"', "1.0", "", "v1.0.0", "1.0.0-rc.1"]) {
    assert.throws(() => applyVersion(gradle, { code: 1, name }), /versionName/, name);
  }
  for (const code of [0, 1.5, "1", 2100000001]) {
    assert.throws(() => applyVersion(gradle, { code, name: "1.0.0" }), /versionCode/, String(code));
  }
});

function steps(workflow) {
  return [...workflow.matchAll(/^ {6}- (?:name: (.+)|uses: (.+))$/gm)].map((match) => ({
    name: match[1] ?? match[2], index: match.index,
  }));
}

test("android.yml sets the version with the tool before both builds and keeps signing and license steps", () => {
  const workflow = read(".github/workflows/android.yml");
  const list = steps(workflow);
  const find = (name) => {
    const found = list.findIndex((step) => step.name === name);
    assert.notEqual(found, -1, name);
    return found;
  };
  const version = find("Set version code and name");
  const block = workflow.slice(list[version].index, list[version + 1].index);
  assert.match(block, /BUILD_REF: \$\{\{ github\.ref \}\}/);
  assert.match(block, /RUN_NUMBER: \$\{\{ github\.run_number \}\}/);
  assert.match(block, /run: node tools\/android-version\.mjs android\/app\/build\.gradle "\$BUILD_REF" "\$RUN_NUMBER"/);
  assert.ok(find("Create Android project") < version);
  assert.ok(find("Sync web assets") < version);
  assert.ok(version < find("Build debug APK"));
  assert.ok(version < find("Build unsigned release APK"));
  assert.ok(find("Build unsigned release APK") < find("Align, sign and verify release APK"));
  assert.doesNotMatch(workflow, /node --input-type=module/);
  assert.equal((workflow.match(/android-version\.mjs/g) ?? []).length, 3);

  // 빌드한 APK마다 업로드 전에 aapt2로 두 값을 읽어 도구가 정한 값과 비교한다.
  for (const [build, check, upload, apk, condition] of [
    ["Build debug APK", "Check debug APK version", "Upload debug APK",
      "android/app/build/outputs/apk/debug/app-debug.apk", "startsWith(github.ref, 'refs/tags/v') == false"],
    ["Align, sign and verify release APK", "Check release APK version", "Upload verified release APK",
      "dist/aio-release.apk", "startsWith(github.ref, 'refs/tags/v')"],
  ]) {
    const at = find(check);
    assert.equal(at, find(build) + 1, `${check} follows ${build}`);
    assert.equal(find(upload), at + 1, `${upload} follows ${check}`);
    const stepText = workflow.slice(list[at].index, list[at + 1].index);
    assert.ok(stepText.includes(`        if: ${condition}\n`) || stepText.includes(`        if: ${condition}\r\n`), check);
    assert.match(stepText, /BUILD_REF: \$\{\{ github\.ref \}\}/);
    assert.match(stepText, /RUN_NUMBER: \$\{\{ github\.run_number \}\}/);
    assert.match(stepText, /test -x "\$build_tools\/aapt2"/);
    assert.ok(stepText.includes(`"$build_tools/aapt2" dump badging ${apk} | node tools/android-version.mjs verify - "$BUILD_REF" "$RUN_NUMBER"`), check);
  }
  // 파이프 앞의 aapt2 실패도 단계를 실패시키도록 bash 기본값(-eo pipefail)을 쓴다.
  assert.match(workflow, /defaults:\r?\n {6}run:\r?\n {8}shell: bash/);
  assert.match(workflow, /cp node_modules\/@capacitor\/app\/LICENSE android\/app\/src\/main\/assets\/licenses\/Capacitor-App-MIT\.txt/);
  for (const secret of ["ANDROID_KEYSTORE_BASE64", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
    assert.match(workflow, new RegExp(`${secret}: \\$\\{\\{ secrets\\.${secret} \\}\\}`), secret);
  }
  assert.match(workflow, /gh release upload "\$RELEASE_TAG" aio-release\.apk SHA256SUMS --clobber/);
});

test("test.yml runs every tests/ file by name, including both new files", () => {
  const workflow = read(".github/workflows/test.yml");
  const run = workflow.match(/^\s*run: node --test (.+)$/m);
  assert.ok(run, "node --test line");
  const listed = run[1].trim().split(/\s+/);
  assert.equal(new Set(listed).size, listed.length, "no duplicates");
  assert.ok(listed.every((file) => /^tests\/[\w-]+\.test\.mjs$/.test(file)), "names only, no wildcards");
  const present = readdirSync(new URL("../tests/", import.meta.url))
    .filter((file) => file.endsWith(".test.mjs")).map((file) => `tests/${file}`);
  for (const file of present) assert.ok(listed.includes(file), `${file} is listed`);
  // 작업 A의 검사 파일은 다른 브랜치에 있어 이름으로만 확인한다.
  assert.ok(listed.includes("tests/release-update.test.mjs"));
  assert.ok(listed.includes("tests/android-version.test.mjs"));
  assert.equal(listed.length, 18);
  assert.match(workflow, /name: Test all eighteen files/);
  assert.match(workflow, /AIO_REQUIRE_FULL_SHELL: '1'/);
});
