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
- 테스트: 저장소 루트에서 `node --test tests/home.test.mjs tests/router.test.mjs tests/api.test.mjs tests/pwa.test.mjs`
- 아이콘: PNG는 저장소에 넣지 않는다. 미리보기·배포 전에 `node tools/make-icons.mjs`로 `web/assets/icons/`에 만든다(테스트는 자동으로 만든다).
- 로컬 미리보기: `node tools/make-icons.mjs` 다음 `python -m http.server 5173 --directory web` 후 http://127.0.0.1:5173
- 안드로이드 포장(Capacitor)과 APK 빌드는 GitHub Actions에서만 `npm`을 쓴다. 로컬 PC에는 안드로이드 SDK가 필요 없다.

## 문서

- [디자인 기준](docs/DESIGN.md) — 이름 규칙, 색, 화면 목록, Stitch 시안
- [아키텍처](docs/ARCHITECTURE.md) — 폴더 구조, API, 배포
- [데이터 정책](docs/DATA_POLICY.md) — 저장소에 넣지 않는 것

## 저작권

교내 대회 출품작이다. 당선 주제의 저작재산권은 국립금오공과대학교에 귀속되므로 임의로 오픈소스 라이선스를 붙이지 않는다. 공개 범위는 서버 저장소의 데이터 정책과 같다.
