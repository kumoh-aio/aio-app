import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { RELEASE_TAG, applyVersion, resolveVersion } from "../tools/android-version.mjs";

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

test("applyVersion ignores commented or quoted declarations and counts same-line duplicates", () => {
  const version = { code: 3, name: "0.0.3-debug" };
  const blockCommented = gradle
    .replace("        versionCode 1\n", "        /*\n        versionCode 1\n")
    .replace('        versionName "1.0"\n', '        versionName "1.0"\n        */\n');
  const lineCommented = gradle.replace("        versionCode 1", "        // versionCode 1");
  const sameLine = gradle.replace("minSdkVersion rootProject.ext.minSdkVersion",
    "minSdkVersion 23; versionCode 9");
  const quoted = gradle.replace('applicationId "kr.example.aio"', 'applicationId "versionCode 5"')
    .replace("        versionCode 1\n", "");
  for (const [label, source] of Object.entries({ blockCommented, lineCommented, sameLine, quoted })) {
    assert.throws(() => applyVersion(source, version), /Expected exactly one version(Code|Name)/, label);
  }
  // 앞에 붙은 인라인 주석은 선언을 바꾸지 않는다.
  const inlineBlock = applyVersion(gradle.replace("versionCode 1", "/* old */ versionCode 1"), version);
  assert.match(inlineBlock, /\/\* old \*\/ versionCode 3\n/);
  // 문자열과 주석 속 단어는 세지 않고, 그 밖의 선언은 그대로 바꾼다.
  const noisy = gradle
    .replace('applicationId "kr.example.aio"', 'applicationId "kr.example.aio" // "versionName" 2')
    .replace("    namespace", "    /* versionCode 7 */\n    namespace")
    .replace("}\n}\n", "}\n    buildTypes { release { resValue 'string', 'tag', 'versionCode' } }\n}\n😀\n");
  const out = applyVersion(noisy, version);
  assert.match(out, /^ {8}versionCode 3$/m);
  assert.match(out, /^ {8}versionName "0\.0\.3-debug"$/m);
  assert.match(out, /\/\* versionCode 7 \*\//);
  assert.match(out, /'versionCode'/);
  assert.match(out, /😀\n$/);
});

test("triple-quoted and interpolated strings never count as declarations", () => {
  const version = { code: 42, name: "1.2.3" };
  for (const quote of ["'''", '"""']) {
    const only = `def sample = ${quote}\nversionCode 1\nversionName "1.0"\n${quote}\n`;
    assert.throws(() => applyVersion(only, version), /Expected exactly one versionCode/, quote);
    const notes = `def notes = ${quote}\n        versionCode 5\n        versionName "9.9"\n${quote}\n`;
    const out = applyVersion(gradle + notes, version);
    assert.ok(out.endsWith(notes), `${quote} body is untouched`);
    assert.match(out, /^ {8}versionCode 42$/m);
    assert.match(out, /^ {8}versionName "1\.2\.3"$/m);
  }
  const insideInterpolation = `${gradle}def label = "\${tag("versionCode 5", 'versionName')}"\n`;
  assert.ok(applyVersion(insideInterpolation, version).endsWith(`def label = "\${tag("versionCode 5", 'versionName')}"\n`));
  const reference = `${gradle}def label = "build \${versionCode}"\n`;
  assert.throws(() => applyVersion(reference, version), /Expected exactly one versionCode .* found 2/);
  const interpolatedName = gradle.replace('versionName "1.0"', 'versionName "v$suffix"');
  assert.throws(() => applyVersion(interpolatedName, version), /Expected exactly one versionName/);
});

test("statements separated by semicolons on one line are declarations", () => {
  const version = { code: 42, name: "1.2.3" };
  assert.equal(
    applyVersion('android { defaultConfig { versionCode 1; versionName "1.0" } }', version),
    'android { defaultConfig { versionCode 42; versionName "1.2.3" } }',
  );
  assert.equal(
    applyVersion("defaultConfig {\n  versionCode = 7 // build\n  versionName = '1.0';\n}\n", version),
    'defaultConfig {\n  versionCode = 42 // build\n  versionName = "1.2.3";\n}\n',
  );
  assert.throws(() => applyVersion('defaultConfig { foo versionCode 1; versionName "1.0" }', version),
    /Expected exactly one versionCode/);
  assert.throws(() => applyVersion('defaultConfig { versionCode 1 + 1; versionName "1.0" }', version),
    /Expected exactly one versionCode/);
});

test("syntax the tokenizer cannot read fails instead of guessing", () => {
  const version = { code: 1, name: "1.0.0" };
  for (const tail of ["def a = '''open\n", 'def a = "open\n', "/* open\n", "def a = $/versionCode 2/$\n",
    'def a = "${open\n']) {
    assert.throws(() => applyVersion(gradle + tail, version), /Unsupported or malformed Gradle syntax/, tail);
  }
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
  assert.equal((workflow.match(/android-version\.mjs/g) ?? []).length, 1);
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
