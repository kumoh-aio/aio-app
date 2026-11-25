# 아이오(AIO) 앱 — 금오공대 학사 행정 AI

구미 국립금오공과대학교 학생을 위한 학사 행정 AI **아이오(AIO)**의 모바일 앱이다. 학사 규정 질문에 근거 조문을 붙여 답하고, 졸업 요건·학사일정·비교과 추천·사진 속 안내문 읽기를 한 앱에서 쓴다.

- **아이오(AIO)** — AI 비서의 이름이다. AI + 금오의 '오', 공대의 I/O, 학사 행정 올인원(All-In-One)을 뜻한다. AI가 말하거나 사용자가 AI를 부르는 자리에는 이 이름을 쓴다.
- **테크모** — AI를 친숙하게 보이게 하는 삼족오 캐릭터다. 그림으로만 등장하고, 앱이나 AI의 이름으로 쓰지 않는다.
- 학교는 이미 "금오AI"라는 다른 서비스를 운영한다. 헷갈리지 않게 그 이름은 쓰지 않는다.

## 이번 주 목표

| 결과물 | 방법 |
| --- | --- |
| 설치형 웹앱(PWA) | 아이폰·안드로이드에서 "홈 화면에 추가"로 설치한다. 비용 없음 |
| 안드로이드 APK | GitHub Actions가 빌드해 내려받을 수 있게 올린다. 구글 플레이 정식 출시는 신규 개인 개발자 계정 조건(테스터 12명·14일 비공개 테스트) 때문에 이번 주 범위가 아니다 |

## 서버

앱은 화면만 맡고, 답변·검색·졸업 계산은 기존 웹 서비스의 API를 그대로 부른다.

- 서버 저장소: [namelesspark/kumoh-academic-rag](https://github.com/namelesspark/kumoh-academic-rag)
- 공개 주소: https://kumoh-campus.onrender.com
- 사용할 API와 서버 쪽에 필요한 변경(CORS)은 [아키텍처](docs/ARCHITECTURE.md)에 적었다.

## 개발 방식

- 화면은 의존성 없는 HTML·CSS·JavaScript 모듈로 만든다. 서버 저장소의 `api/app/chat_web`과 같은 방식이라 같은 도구로 검사한다.
- 테스트: 저장소 루트에서 아래 명령으로 18개 파일을 하나씩 적어 돌린다. 와일드카드에 기대지 않는다. 목록은 `.github/workflows/test.yml`과 같고, 검사 파일을 새로 만들면 두 곳에 함께 넣는다. `AIO_REQUIRE_FULL_SHELL=1`을 켜면 화면 모듈이 빠졌을 때 건너뛰지 않고 실패한다(CI 기본값).

  ```sh
  AIO_REQUIRE_FULL_SHELL=1 node --test tests/android-version.test.mjs tests/release-update.test.mjs tests/send-icon.test.mjs tests/quick-actions.test.mjs tests/handwriting-pad.test.mjs tests/appearance.test.mjs tests/home.test.mjs tests/router.test.mjs tests/api.test.mjs tests/pwa.test.mjs tests/chat-client.test.mjs tests/chat-history.test.mjs tests/chat-view.test.mjs tests/demo-login.test.mjs tests/graduation-view.test.mjs tests/calendar-view.test.mjs tests/calendar-grid.test.mjs tests/selection-indicator.test.mjs
  ```
- 아이콘: PNG는 저장소에 넣지 않는다. 미리보기·배포 전에 `node tools/make-icons.mjs`로 `web/assets/icons/`에 만든다. 테스트는 파일을 쓰지 않고 메모리에서 만든 바이트를 검사한다.
- 로컬 미리보기: `node tools/make-icons.mjs` 다음 `python -m http.server 5173 --directory web` 후 http://127.0.0.1:5173
- 안드로이드 포장(Capacitor)과 APK 빌드는 GitHub Actions에서만 `npm`을 쓴다. 로컬 PC에는 안드로이드 SDK가 필요 없다.

## PWA 배포(Render 정적 사이트)

Render 무료 정적 사이트를 쓴다. Render에 저장소 조직 접근 권한이 있어야 한다.

1. Render에서 **New → Static Site**를 고르고 이 저장소의 `main` 브랜치를 연결한다.
2. Build Command: `node tools/make-icons.mjs` (아이콘 PNG를 `web/assets/icons/`에 만든다. `npm`은 쓰지 않는다)
3. Publish Directory: `web`
4. 배포 주소(`https://….onrender.com`)가 나오면 서버 저장소의 CORS 허용 출처에 넣는다. 그 전에는 화면만 열리고 API 호출은 막힌다.
5. 화면 파일을 바꿔 배포할 때는 `web/sw.js`의 `CACHE_NAME` 판 번호를 올린다. 새 서비스 워커가 이전 판 캐시를 지운다. API 응답은 캐시하지 않는다.

## 설치

- **Android · Chrome**: 배포 주소를 열고 오른쪽 위 ⋮ 메뉴 → "홈 화면에 추가"나 "앱 설치" → "설치".
- **iPhone · Safari**: 배포 주소를 열고 공유 버튼(안 보이면 주소창 옆 ··· 메뉴) → "홈 화면에 추가" → "추가".
- 앱 안에서는 **더보기** 탭에 같은 안내가 있다. 홈 화면 아이콘으로 열면 주소창 없이 `#/home`부터 시작하고, 한 번 연 화면은 오프라인에서도 열린다.
- **안드로이드 APK**: 저장소의 [최신 릴리스](https://github.com/kumoh-aio/aio-app/releases/latest)에서 `aio-release.apk`를 받는다. 로그인 없이 누구나 받을 수 있다. 설치한 앱은 열 때 새 버전이 있는지 확인하고, 있으면 받을지 묻는다. [받기]는 같은 릴리스의 APK 주소를 기본 브라우저로 연다.
- **테스트용 앱에서 넘어갈 때**: Actions 산출물로 받은 테스트용 앱(버전 이름이 `-debug`로 끝남)은 서명 키가 달라 릴리스 APK로 덮어 설치할 수 없다. 테스트용 앱을 지운 뒤 설치한다. 앱을 지우면 기기에 저장된 대화 기록도 지워진다.

## 안드로이드 새 버전 내기

릴리스 APK는 `v*` 태그를 올릴 때만 만들어진다. 서명 키 만들기와 태그 올리기는 저장소 소유자가 맡는다.

| 빌드 | versionName | versionCode |
| --- | --- | --- |
| `v<주>.<부>.<수>` 태그 (예: `v1.0.0`) | 태그에서 `v`를 뺀 값 (`1.0.0`) | Actions 실행 번호 |
| main 푸시·PR | `0.0.<실행 번호>-debug` | Actions 실행 번호 |

태그는 `^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$` 형식이어야 한다. `v1.2`, `v01.2.3`, `v1.2.3-rc.1`처럼 형식이 다르면 `tools/android-version.mjs`가 빌드 전에 실패시킨다.

1. **서명 키 만들기(처음 한 번)** — JDK의 `keytool`로 만든다. 별칭과 비밀번호는 직접 정한다.

   ```sh
   keytool -genkeypair -v -keystore aio-release.keystore -alias aio -keyalg RSA -keysize 4096 -validity 10000
   ```

   - 키 파일과 비밀번호는 저장소 밖(비밀번호 관리자, 오프라인 백업 두 곳 이상)에 둔다. 저장소에 커밋하지 않는다.
   - 키를 잃으면 이미 설치한 앱 위에 새 버전을 덮어 설치할 수 없다. 사용자가 앱을 지우고 다시 깔아야 하고, 그때 대화 기록이 지워진다.
2. **저장소 Secrets 등록(처음 한 번)** — GitHub 저장소 **Settings → Secrets and variables → Actions → New repository secret**에서 네 개를 넣는다.

   | 이름 | 값 |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | 키 파일을 base64로 바꾼 한 줄 (`base64 -w0 aio-release.keystore`, macOS는 `base64 -i aio-release.keystore`) |
   | `ANDROID_KEYSTORE_PASSWORD` | 키 저장소 비밀번호 |
   | `ANDROID_KEY_ALIAS` | `keytool`의 `-alias` 값 (위 예시는 `aio`) |
   | `ANDROID_KEY_PASSWORD` | 키 비밀번호 (따로 정하지 않았으면 키 저장소 비밀번호와 같음) |

3. **태그 올리기** — 내보낼 커밋이 main에 병합된 뒤 올린다. 버전은 이전 릴리스보다 높아야 앱이 새 버전으로 안내한다.

   ```sh
   git switch main
   git pull
   git tag v1.0.0
   git push origin v1.0.0
   ```

4. **확인** — Actions의 **Android APK** 실행이 끝나면 같은 이름의 릴리스에 `aio-release.apk`와 `SHA256SUMS`가 붙는다. 이전 버전을 설치한 기기에서 앱을 열어 안내 창이 뜨는지 본다.

## 문서

- [디자인 기준](docs/DESIGN.md) — 이름 규칙, 색, 화면 목록, Stitch 시안
- [아키텍처](docs/ARCHITECTURE.md) — 폴더 구조, API, 배포
- [데이터 정책](docs/DATA_POLICY.md) — 저장소에 넣지 않는 것

## 저작권

교내 대회 출품작이다. 당선 주제의 저작재산권은 국립금오공과대학교에 귀속되므로 임의로 오픈소스 라이선스를 붙이지 않는다. 공개 범위는 서버 저장소의 데이터 정책과 같다.
