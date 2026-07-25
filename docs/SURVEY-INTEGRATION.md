# now-here-survey 연동 가이드

Persona Loop가 이미 운영 중인 현장 설문 서비스 **[now-here-survey](https://gihoon-mx.github.io/now-here-survey/)** 의 응답을
**읽기 전용**으로 가져와 페르소나의 재료로 쓰는 방법.

- 원본 서비스: https://gihoon-mx.github.io/now-here-survey/ (저장소: https://github.com/gihoon-mx/now-here-survey)
- 연동 코드: [`packages/core/survey-source.js`](../packages/core/survey-source.js) · 화면: [`apps/survey/`](../apps/survey/)

---

## 1. 왜 통합했나

설문을 만들고 현장에서 진행하는 도구는 **이미 있다.** now-here-survey는 진행자가 페이지를 넘기며
참가자에게 문항을 여는 실시간 방식으로 실제 현장에서 돌아가고 있고, 참가자 관리·엑셀 내보내기까지 갖춰져 있다.

Persona Loop가 여기에 설문 기능을 하나 더 만드는 것은 **중복이고, 데이터가 두 곳으로 갈라진다.**
그래서 Persona Loop는 설문을 새로 만들지 않고 **응답을 재료로 가져다 쓴다.**
설문 설계와 현장 진행은 계속 now-here-survey에서 하고, Persona Loop는 그 결과에 페르소나 차원을 태깅해
페르소나를 만들고 Agent 리뷰로 이어간다.

### 역할 분담

| | now-here-survey | Persona Loop |
|---|---|---|
| 설문 설계 (페이지·문항 편집) | ✅ 담당 | ❌ 안 함 (연동 서베이는 편집 불가) |
| 현장 진행 (페이지 열기·실시간 진행) | ✅ 담당 | ❌ 안 함 |
| 참가자 관리 (로그인 아이디·passcode 발급) | ✅ 담당 | ❌ 안 함 (실명·아이디를 가져오지도 않는다) |
| 응답 수집·엑셀 내보내기 | ✅ 담당 | ❌ 안 함 |
| 페르소나 차원(`personaDimension`) 태깅 | ❌ | ✅ 담당 |
| 페르소나 생성 (Gemini) | ❌ | ✅ 담당 |
| Agent 데모 리뷰·세션 리플레이 | ❌ | ✅ 담당 |
| 데이터 원본(source of truth) | ✅ **원본은 항상 여기** | 사본(스냅샷)을 보관 |

한 줄 요약: **now-here-survey = 설문의 원본, Persona Loop = 페르소나의 작업장.**

---

## 2. 읽기 전용 보장

> Persona Loop는 now-here-survey의 **데이터도 진행 상태도 바꾸지 않는다.**

운영 중인 서비스이므로 이 원칙은 협상 대상이 아니다. 코드 수준에서 다음과 같이 보장된다.

`packages/core/survey-source.js`의 구조:

- 데이터에 접근하는 함수는 **`get()` 하나뿐이다.** 이 함수는 `fetch(...)`에 method를 지정하지 않는다 — 즉 **GET만 보낸다.**
  `listSourceSurveys` / `listSourceSessions` / `getSourceStructure` / `listSourceParticipants` / `listSourceResponses`가
  전부 이 `get()`을 통해서만 동작한다.
- 파일 전체에 `POST`는 **인증 토큰 발급·갱신 두 곳**(`/auth/v1/token`)뿐이고, `PATCH`·`PUT`·`DELETE`·Supabase RPC 호출은 **하나도 없다.**
  현장 진행에 쓰이는 `submit_response()`·`submit_comment()`·`claim_participant()` 같은 원본 시스템의 쓰기 함수는 부르지 않는다.
- Realtime 구독도 하지 않는다. 진행 중인 회차의 페이지 전환·참가자 상태에 어떤 영향도 주지 않는다.
- 변환(`convertSession()`)은 순수 함수다. 읽어온 데이터를 Persona Loop 스키마로 바꿔 **Firestore에만** 쓴다.

**유지 규칙**: 이 파일에 쓰기 코드(POST/PATCH/DELETE/RPC)를 추가하지 말 것.
연동 기능을 확장할 일이 생기면 "Persona Loop 쪽에서 해결할 수 없는가"를 먼저 확인한다.

---

## 3. 인증 — 왜 로그인이 필요한가

now-here-survey의 Supabase는 **RLS(Row Level Security) 정책이 전부 `to authenticated`** 로만 걸려 있다.
`anon` 역할에는 어떤 테이블에도 권한이 없다. 따라서 공개(anon) 키만으로는 **아무것도 읽히지 않는다.**
데이터를 읽으려면 `admins` 테이블에 등록된 **설문 시스템 관리자 계정으로 로그인**해야 한다.

- 로그인 자격증명은 사용자가 Persona Loop의 연동 화면에 **직접 입력**한다. 저장소·코드에 넣지 않는다.
- `connectSource()`는 로그인 직후 `isSourceAdmin()`으로 관리자 여부를 확인하고, 관리자가 아니면 즉시 연결을 끊고 예외를 던진다
  (관리자가 아니면 RLS 때문에 어차피 아무 데이터도 안 보이므로, 빈 화면 대신 명확한 오류를 준다).
- **토큰은 `sessionStorage`에만 둔다.** `localStorage`가 아니다 — 탭을 닫으면 사라진다.
  현장에서 공유 PC나 남의 노트북으로 작업하는 경우를 고려한 선택이다. 브라우저를 닫으면 다음 사람은 다시 로그인해야 한다.
- 공개 anon 키(`SURVEY_SOURCE.key`)는 브라우저 노출을 전제로 설계된 값이라 코드에 있어도 무방하다.
  실제 접근 통제는 Postgres RLS가 한다.

Persona Loop 자체 로그인(Firebase / Google)과는 **별개의 로그인**이다. 연동 화면을 쓰려면 둘 다 필요하다.

---

## 4. 데이터 매핑

### 문항 (slides → questions)

| now-here-survey | Persona Loop | 비고 |
|---|---|---|
| `choice` (multi=false) | `single` | 선택지 라벨 그대로 |
| `choice` (multi=true) | `multi` | 복수 응답 |
| `ox` | `single` (선택지 `O`·`X`) | |
| `text` | `open` | 주관식 |
| `info` (안내 페이지) | **제외** | 문항이 아니라 안내 화면이라 가져오지 않는다 |
| 문항의 자유 의견(`comment`) | `<qid>-c` 주관식 문항 | 아래 참고 |

- 문항 id는 **페이지 순서 → 페이지 내 순서**로 펼친 뒤 `q1`, `q2`, … 로 새로 매긴다. 원본 UUID는 문항 id로 쓰지 않는다.
- `slides.body`가 있으면 문항의 `description`으로 옮긴다.
- 선택지(`options`)는 문자열 배열과 `{label, description}` 객체 배열이 섞여 있을 수 있어, 양쪽 모두 라벨만 뽑아낸다.

**의견(comment)을 별도 문항으로 만드는 이유**: now-here-survey는 문항마다 자유 의견란을 열 수 있고,
여기 적힌 말이 **페르소나의 가장 좋은 재료**다("왜 그렇게 골랐는지"가 들어 있다).
객관식 집계에 묻히지 않도록, 의견이 **하나라도 달린 문항에 한해** `q3-c` 같은 주관식 문항을 하나 더 만들어 담는다
(제목: `[의견] 원래 문항 제목`). 아무도 의견을 안 남긴 문항에는 만들지 않는다.

### 서베이 문서

| 필드 | 값 |
|---|---|
| `title` | `<설문 제목> — <회차 이름>` |
| `status` | `imported` |
| `source` | `now-here-survey` |
| `externalRef` | `{surveyId, sessionId, syncedAt}` — 재동기화 대상 식별용 |

### 응답 (responses)

- `answer` JSON에서 `text` / `choices`(배열) / `choice` 중 있는 값을 꺼내 `answers[qid]`에 넣는다.
- `comment`가 있으면 `answers['<qid>-c']`에 넣는다.
- `submittedAt`은 그 참가자의 응답 중 **가장 이른 `answered_at`** 을 쓴다.
- 답을 하나도 남기지 않은 참가자는 행을 만들지 않는다.

---

## 5. 개인정보

> 참가자의 **실명·표시 이름·로그인 아이디·passcode는 Persona Loop로 가져오지 않는다.**

- `passcode`는 애초에 SELECT 권한 밖이라 요청 자체를 하지 않는다.
- `display_name`·`login_id`는 참가자 **순서를 매기기 위해서만** 잠시 쓰이고, 저장되는 것은 `P1`, `P2`, … 익명 라벨뿐이다
  (`respondentLabel` 필드). Firestore에 개인 식별자가 남지 않는다.
- 자유 의견 본문은 그대로 가져온다. 여기에 이름·소속 같은 개인정보가 적혀 있을 수 있으므로,
  **연동 전에 원본 시스템에서 한 번 훑어보는 것**을 권한다. 발견하면 원본(now-here-survey)에서 고친 뒤 다시 동기화한다.
- 익명 라벨(`P1`…)은 **회차 안에서만** 유효하다. 다른 회차의 `P1`과는 아무 관계가 없다.

Persona Loop의 다른 원칙(모든 화면은 admin 게이트 뒤, 데이터는 Firestore에만)이 여기에도 그대로 적용된다.
연동으로 들어온 응답도 repo에 커밋되지 않는다.

---

## 6. 사용 절차

Persona Loop에 관리자로 로그인한 상태에서:

1. **프로젝트 선택** → Survey 모듈 진입 → **설문 시스템 연동** 열기
2. **설문 시스템에 로그인** — now-here-survey 관리자 계정의 이메일·비밀번호를 입력한다
   (Persona Loop 계정이 아니다. 관리자가 아니면 오류가 뜬다)
3. **설문 선택** — 연동 계정이 볼 수 있는 설문 목록이 뜬다
4. **회차 선택** — 회차별 상태(초안 / 진행 중 / 종료)와 시각을 보고 고른다. **종료된 회차를 권장**한다(§7 참고)
5. **미리보기 확인** — 가져올 문항 수·응답자 수, 제외되는 `info` 문항, 추가되는 `[의견]` 문항을 확인한다
6. **가져오기 실행** — 서베이 문서와 응답이 Firestore에 저장된다
7. **페르소나 차원 태깅** — 서베이 상세에서 각 문항에 `personaDimension`(인구통계·목표·페인포인트 등)을 지정한다.
   이 태깅이 페르소나 생성의 근거 연결 기준이 된다 — **연동 후 반드시 해야 하는 단계다**
8. 이후 페르소나 생성(M05) → 데모 리뷰(M07)로 이어간다

연동을 마쳤으면 화면에서 **연결 해제**를 눌러 토큰을 지운다(탭을 닫아도 사라지지만, 명시적으로 끊는 편이 낫다).

---

## 7. 재동기화

같은 회차를 다시 가져오면 **기존 응답을 지우고 새로 넣는다.**
`core.importResponses(pid, sid, rows, { source: 'now-here-survey', replace: true })` 가 이 동작을 담당한다.

- `source`가 `'now-here-survey'`인 기존 응답 문서를 먼저 전부 삭제한 뒤 새로 쓴다 → **중복 누적이 생기지 않는다.**
- `responseCount`는 증가가 아니라 **덮어쓰기**로 갱신된다.

**주의점**

- 재동기화는 **응답만 갈아끼우는 것이 아니라 서베이 정의도 다시 쓴다.** 원본에서 문항을 추가·삭제·재정렬했다면
  `q1`, `q2` … 번호가 밀려 **직접 지정한 `personaDimension` 태깅이 엉뚱한 문항에 붙을 수 있다.**
  문항 구성이 바뀐 뒤 다시 동기화했다면 태깅을 반드시 다시 확인한다.
- 같은 프로젝트에 **직접 만든 서베이나 CSV 임포트 응답이 섞여 있어도 안전하다.** 삭제 대상은 `source`가
  `'now-here-survey'`인 문서로 한정되며, `'live'`(공개 폼 응답)·`'import'`(CSV)는 건드리지 않는다.
- 재동기화는 Persona Loop 쪽 사본만 바꾼다. **원본은 여전히 아무 영향도 받지 않는다.**

---

## 8. 한계 (알고 쓸 것)

- **실시간 반영이 아니다.** 버튼을 눌러야 가져오는 **수동 스냅샷**이다. 원본에서 응답이 추가돼도 Persona Loop는 모른다.
  `externalRef.syncedAt`이 "언제 찍은 사본인가"를 알려준다.
- **진행 중(`live`) 회차는 응답이 계속 늘어난다.** 진행 도중에 가져오면 반쪽짜리 스냅샷이 되고,
  끝난 뒤 다시 가져오면 페르소나의 근거가 통째로 바뀐다. **회차를 종료(`ended`)한 뒤 동기화하는 것을 권장한다.**
- **문항 수정은 원본에서만 한다.** 연동으로 들어온 서베이는 Persona Loop에서 편집하지 않는 것을 전제로 한다
  (편집해도 다음 재동기화에서 덮어써진다). 고칠 것은 now-here-survey에서 고치고 다시 가져온다.
- **원본에서 회차나 설문이 삭제되면** Persona Loop의 사본은 남지만 재동기화는 실패한다. 사본은 스냅샷으로 계속 유효하다.
- **연동 서베이는 응답 링크를 열 수 없다.** `status`가 `imported`라 공개 폼(`public-forms`) 문서가 만들어지지 않는다 —
  응답 수집은 원본 시스템의 몫이라는 역할 분담과 일치한다.
- 브라우저에서 직접 Supabase에 접근하므로 **응답이 아주 많은 회차는 한 번에 오래 걸릴 수 있다.**
  (현재 현장 규모인 수십 명 × 수십 문항에서는 문제되지 않는다.)

---

## 관련 문서

- [ARCHITECTURE.md §8 설문 시스템 연동](../ARCHITECTURE.md) — 설계 결정
- [`packages/core/schemas/survey.schema.json`](../packages/core/schemas/survey.schema.json) — `source`·`externalRef` 필드 정의
- [CLAUDE.md](../CLAUDE.md) — 보안 원칙 (읽기 전용 유지 규칙)
