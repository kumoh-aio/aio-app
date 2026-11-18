# 아키텍처

## 구성

```
aio-app/
├─ web/                 # PWA 화면(정적 파일)
│  ├─ index.html
│  ├─ manifest.webmanifest
│  ├─ sw.js             # 서비스 워커: 화면 파일만 캐시, API 응답은 캐시하지 않음
│  └─ assets/           # app.js, app.css, 아이콘, 테크모 그림
├─ tests/               # node --test 로 실행하는 화면 테스트
├─ capacitor.config.json
├─ .github/workflows/   # 테스트, APK 빌드, PWA 배포
└─ docs/
```

- 앱은 서버 주소 하나(`API_BASE`, 기본 `https://kumoh-campus.onrender.com`)만 알고 모든 데이터를 API로 받는다.
- 화면 파일은 외부 스크립트·글꼴을 불러오지 않는다. 보안 정책(Content-Security-Policy)은 `default-src 'self'`에 API 주소만 `connect-src`로 더한다.

## 사용할 서버 API

경로 앞에 `/api/v1`이 붙는다. 자세한 형식은 서버 저장소의 `api/docs/API_SPEC.md`가 기준이다.

| 기능 | API |
| --- | --- |
| 아이오 채팅(스트림) | `POST /chat/stream` — 이벤트 meta / thinking / answer / notice / done / error. 본문에 `mode`(fast·deep), `lang`(ko·en·zh) |
| 채팅(한 번에) | `POST /chat` — 스트림이 안 될 때 대체 |
| 서버 상태 | `GET /health` |
| 시연 계정 | `GET /demo-students`, `POST /demo-login` — 실제 학번·비밀번호는 받지 않는다 |
| 졸업 요건 진단 | `GET /graduation-demo` |
| 학사일정 | `GET /academic-calendar/{year}/{term}` |
| 캠퍼스 안내 | `GET /campus-guide` |
| 사진 속 안내문 | `POST /photo-question`, `POST /poster-lookup` |

## 서버 쪽에 필요한 변경

지금 서버에는 CORS 설정이 없어 다른 주소의 앱이 API를 부를 수 없다. 서버 저장소에 아래를 이슈로 낸다.

- 허용 출처: PWA 배포 주소, Capacitor 안드로이드 앱 출처(`https://localhost`), 로컬 미리보기(`http://127.0.0.1:5173`).
- 허용 메서드 GET·POST, 헤더 `Content-Type`. 쿠키를 쓰지 않으므로 자격 증명 허용은 끈다.

## 배포

| 대상 | 방법 |
| --- | --- |
| PWA | 빌드 명령 `node tools/make-icons.mjs`로 아이콘을 만든 뒤 `web/`을 정적 사이트로 올린다. 비공개 저장소라 무료 GitHub Pages는 쓸 수 없으므로 Render 무료 정적 사이트를 쓴다(Render에 kumoh-aio 조직 접근 허용 필요) |
| 안드로이드 APK | GitHub Actions에서 `node tools/make-icons.mjs`로 아이콘을 만들고 Capacitor로 `web/`을 감싸 Gradle로 빌드하고, 결과 APK를 실행 결과물(artifact)과 릴리스에 올린다. 서명 키는 저장소 비밀값(secrets)에만 둔다 |

## 개발 흐름

로컬 대시보드(Codex × Claude Code)가 이 저장소의 이슈를 만들고 두 봇(`kumoh-codex-bot`, `kumoh-claude-bot`)이 PR을 올린다. 검사 명령은 `node --test tests/home.test.mjs tests/router.test.mjs tests/api.test.mjs tests/pwa.test.mjs`다.
