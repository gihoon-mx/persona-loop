# Persona Loop

실제 서베이 응답으로 페르소나를 만들고, 그 페르소나 AI Agent가 데모 서비스를 직접 사용해본 뒤 리뷰를 남기는 올인원 리서치 플랫폼.

**루프**: 서베이 → 페르소나 생성 → 데모 사용(Agent) → 리뷰 → 서비스 개선 → (반복)

- 배포: https://gihoon-mx.github.io/persona-loop/ — **비공개 워크스페이스(Google 로그인 필요)**
- 데이터는 전부 Firestore에 있고 허용된 계정만 접근할 수 있다. 비로그인으로 열 수 있는 것은 **공개 응답 링크를 받은 서베이 폼**뿐이다.
- 첫 프로젝트: now-here (https://gihoon-mx.github.io/now-here-demo/)

## 구조

```
apps/       모듈별 웹앱 (Pages로 서빙) — survey / persona / review
agents/     AI Agent 프롬프트·실행 스크립트 (GitHub Actions에서 실행)
packages/   공유 스키마 + 공통 코어 (core.js = 인증·권한 게이트·데이터 API)
data/seed/  가상 샘플 시드 — 관리자가 설정 화면에서 Firestore에 적재하는 데모 데이터
tools/      검증 스크립트 (verify-personas.mjs = 페르소나 근거 대조, check-rules.sh = 보안 규칙 확인)
```

페르소나를 저장하기 전에는 근거 대조를 통과시킨다 (외부 의존성 없음):

```bash
node tools/verify-personas.mjs
```

핵심 구성: **Pages = UI, Actions = Agent 런타임, Firestore = 유일한 데이터 저장소, Firebase Auth + 보안 규칙 = 접근 통제**

Agent가 호출하는 AI 모델은 **Google Gemini**(Agent Platform, 구 Vertex AI)다. 제공자·모델·단가의 단일 기준은 [docs/AI-PROVIDER.md](docs/AI-PROVIDER.md).

실데이터는 repo에 커밋하지 않는다. `data/seed/sample/`의 창작 데이터만 예외다.

상세 설계는 [ARCHITECTURE.md](ARCHITECTURE.md), 모듈 규칙은 [MODULES.md](MODULES.md), AI 제공자는 [docs/AI-PROVIDER.md](docs/AI-PROVIDER.md), Firebase 셋업은 [docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md), 진행 상태는 [WORKLOG.md](WORKLOG.md) 참고.

## 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| 0 | 스캐폴딩 + Pages 배포 파이프라인 | ✅ |
| 1 | 서베이 임포트 툴 + 결과 대시보드 | 🔶 툴 완성, now-here 40문항×35명 실데이터 임포트 대기 |
| 2 | 페르소나 빌더 (서베이 → 페르소나, 근거 인용 포함) | 🔶 뷰어 완성, 생성 Agent(Gemini 배치) 예정 |
| 3 | 데모 리뷰어 (Agent가 실제 브라우저로 데모 사용 + 리뷰 작성) | 🔶 뷰어·세션 리플레이 완성, Agent(Gemini 2.5 Flash) 예정 |
| 4 | 서베이 스튜디오 (생성·공개 응답 폼 완성 / 코칭 기능 예정) | 🔶 |
| 5 | **비공개 전환 (v0.3)** — 전 화면 로그인 게이트, Firestore 단일 저장소, 웹에서 관리자 추가·삭제 | ✅ |
| 6 | **AI 제공자 전환 (2026-07-25)** — Claude API → Gemini on Agent Platform ([근거](docs/AI-PROVIDER.md)) | ✅ 결정 / 구현 전 |
