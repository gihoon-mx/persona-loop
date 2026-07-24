# persona-builder (M05)

서베이 응답(원본은 Firestore, 실행 시 익명화하여 로드) → 응답자 클러스터링 → 클러스터별 페르소나 생성.

- 출력: Firestore `projects/<pid>/personas/{id}` 문서 (persona.schema.json 준수). v0.3부터 repo에는 페르소나가 저장되지 않는다.
- **모든 특성에 evidence 필수** — 근거 없는 특성은 생성 금지, 응답 인용/집계 수치로 연결
- 실행: GitHub Actions `workflow_dispatch` (Claude API 사용 → 실행 전 비용 고지)
  - Actions에서 Firestore에 쓰려면 **Firebase 서비스 계정(Admin SDK) 키를 repo Secrets에 등록**해야 한다 (ARCHITECTURE.md §7 참고 — 아직 미구현).
  - 더 단순한 대안: 에이전트를 로컬에서 실행하고 결과를 웹 페르소나 화면에서 입력한다. 서비스 계정 키를 만들 필요가 없어 초기에는 이쪽이 안전하다.
- 페르소나 업데이트 시 version 증가 — repo에 데이터가 없으므로 git diff로는 추적되지 않는다. 변경 근거(어떤 서베이가 추가돼 무엇이 바뀌었는지)를 문서 안에 남길 것 (ARCHITECTURE.md §2·§5).
