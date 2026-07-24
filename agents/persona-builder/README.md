# persona-builder (M05)

서베이 응답(원본은 Firestore, 실행 시 익명화하여 로드) → 응답자 클러스터링 → 클러스터별 페르소나 생성.

- 출력: `data/projects/<id>/personas/*.json` (persona.schema.json 준수)
- **모든 특성에 evidence 필수** — 근거 없는 특성은 생성 금지, 응답 인용/집계 수치로 연결
- 실행: GitHub Actions `workflow_dispatch` (Claude API 사용 → 실행 전 비용 고지)
- 페르소나 업데이트 시 version 증가, git diff로 변화 추적
