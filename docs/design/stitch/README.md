# Stitch 시안 원본 (참고 자료)

Google Stitch 프로젝트 "Techmo Academic Assistant App"에서 2026-11-18에 내보낸 화면이다. **참고 자료이며 앱이 내려 주는 파일이 아니다.**

| 파일 | 화면 | 판 |
| --- | --- | --- |
| `home-basic.html`, `home-basic.png` | 홈 | 기본 |
| `home-neumorphic.html`, `home-neumorphic.png` | 홈 | 음각·양각(뉴모피즘) |
| `chat-basic.html` | 아이오 AI 채팅 | 기본 |
| `chat-neumorphic.html`, `chat-neumorphic.png` | 아이오 AI 채팅 | 음각·양각 |
| `graduation-basic.html` | 졸업 요건 진단 | 기본 |
| `graduation-neumorphic.html`, `graduation-neumorphic.png` | 졸업 요건 진단 | 음각·양각 |
| `design-system.md` | Stitch 디자인 시스템 "Academic Intelligence Modern"(색·글자·간격 토큰) | — |

## 옮길 때 지킬 것

- 배치, 간격, 색, 그림자, 문구 흐름만 가져온다. HTML을 그대로 복사하지 않는다.
- Tailwind CDN(`cdn.tailwindcss.com`)과 `lh3.googleusercontent.com` 그림은 쓰지 않는다. 앱은 외부 스크립트·그림을 불러오지 않는다(`docs/ARCHITECTURE.md`). 필요한 스타일은 `web/assets/app.css`에 직접 쓴다.
- 시안의 숫자와 요건 문구(예: 108/130학점, 캡스톤디자인 미이수, 2025-1학기 일정, 많이 묻는 질문)는 예시다. 실제 화면은 서버 API 응답으로 채우고, 규정·요건을 지어내지 않는다.
- 사람 사진·아바타 자리는 테크모 그림(서버 저장소 `api/app/chat_web/art/techmo-sprite.png`) 또는 머리글자 원으로 바꾼다.
- 시안에 남은 "테크모"라는 이름 표기는 아이오로 바꾼다. 테크모는 이름표 없는 캐릭터 그림이다.
