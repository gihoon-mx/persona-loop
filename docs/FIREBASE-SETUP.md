# Firebase 셋업 가이드

Persona Loop의 실시간 기능(프로젝트 생성, 서베이 수집, Google 로그인)을 켜기 위한 1회성 셋업.
**비용: 전부 무료** (Spark 플랜, 카드 등록 불필요). 이 규모(수십~수백 명 응답)는 무료 한도(일 읽기 5만/쓰기 2만) 안에 충분히 들어간다.

## 1. 프로젝트 생성 (2분)
1. https://console.firebase.google.com → **프로젝트 추가**
2. 이름: `persona-loop` → 계속
3. Google 애널리틱스: **사용 안함** (필요 없음) → 프로젝트 만들기

## 2. 웹 앱 등록 + config 복사 (2분)
1. 프로젝트 개요 화면에서 **`</>` (웹)** 아이콘 클릭
2. 앱 닉네임: `persona-loop-web` → 앱 등록 (호스팅 체크 불필요 — GitHub Pages 사용)
3. 화면에 나오는 `const firebaseConfig = { apiKey: ... }` 객체를 통째로 복사
4. 이 config를 Claude에게 붙여넣어 주거나, 직접 `packages/core/firebase-config.js`의 `null` 자리에 넣고 커밋
   - ⚠️ 이 값들은 **공개돼도 안전** (비밀키가 아니라 식별자. 실제 보호는 아래 3·4단계의 도메인 제한 + 보안 규칙이 담당)

## 3. Google 로그인 활성화 (2분)
1. 왼쪽 메뉴 **빌드 > Authentication** → 시작하기
2. **Sign-in method** 탭 → **Google** 선택 → 사용 설정 토글 ON
3. 프로젝트 지원 이메일: `gihoon.mx@gmail.com` 선택 → 저장
4. **Settings** 탭 → **승인된 도메인(Authorized domains)** → **도메인 추가** → `gihoon-mx.github.io` 입력
   - `localhost`는 기본 포함되어 있어 로컬 테스트도 바로 됨 (now-here 때와 동일한 과정)

## 4. Firestore 생성 + 보안 규칙 (3분)
1. 왼쪽 메뉴 **빌드 > Firestore Database** → **데이터베이스 만들기**
2. 위치: `asia-northeast3 (서울)` → **프로덕션 모드**로 시작
3. 생성 후 **규칙** 탭 → repo의 [`firestore.rules`](../firestore.rules) 내용을 통째로 붙여넣고 **게시**
   - 규칙 요약: 프로젝트/서베이 정의는 공개 읽기, 응답 원본 열람은 admin(gihoon.mx@gmail.com)만, 익명 응답 제출은 status가 `open`인 서베이에만 허용

## 5. 확인
config가 커밋·배포되면 https://gihoon-mx.github.io/persona-loop/ 상단의 "읽기 전용" 뱃지가 사라지고 **Google 로그인** 버튼이 나타난다. 로그인하면 admin 뱃지 + "새 프로젝트" 버튼이 보이면 성공.

## 이후 관리 포인트
- admin 추가: `packages/core/firebase-config.js`의 `adminEmails` + `firestore.rules`의 이메일 목록 **두 곳을 같이** 수정
- 사용량 확인: 콘솔 > Firestore > 사용량 탭 (무료 한도 접근 시 이메일 경고 옴 — 자동 과금되지 않음)
