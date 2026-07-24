# Persona Loop

실제 서베이 응답으로 페르소나를 만들고, 그 페르소나 AI Agent가 데모 서비스를 직접 사용해본 뒤 리뷰를 남기는 올인원 리서치 플랫폼.

**루프**: 서베이 → 페르소나 생성 → 데모 사용(Agent) → 리뷰 → 서비스 개선 → (반복)

- 배포: https://gihoon-mx.github.io/persona-loop/
- 첫 프로젝트: [now-here](data/projects/now-here/project.json) (https://gihoon-mx.github.io/now-here-demo/)

## 구조

```
apps/       모듈별 웹앱 (Pages로 서빙) — survey / persona / review
agents/     AI Agent 프롬프트·실행 스크립트 (GitHub Actions에서 실행)
packages/   공유 스키마·공통 코드
data/       프로젝트 단위 데이터 (익명화·집계된 것만 커밋)
```

핵심 구성: **Pages = UI, Actions = Agent 런타임, repo = 버전 관리되는 DB, Firebase = 응답 원본 저장 + Google 인증**

상세 설계는 [ARCHITECTURE.md](ARCHITECTURE.md), 모듈 규칙은 [MODULES.md](MODULES.md), 진행 상태는 [WORKLOG.md](WORKLOG.md) 참고.

## 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| 0 | 스캐폴딩 + Pages 배포 파이프라인 | ✅ |
| 1 | now-here 기존 서베이(40문항×35명) 임포트 + 결과 대시보드 | |
| 2 | 페르소나 빌더 (서베이 → 페르소나, 근거 인용 포함) | |
| 3 | 데모 리뷰어 (Agent가 실제 브라우저로 데모 사용 + 리뷰 작성) | |
| 4 | 서베이 스튜디오 (신규 서베이 생성·코칭 + 실시간 수집) | |
