// Firebase 웹 config. 콘솔(프로젝트 설정 > 내 앱)에서 복사한 객체.
// 이 값들은 공개되어도 안전 — 실제 보호는 승인된 도메인 + Firestore 보안 규칙이 담당한다.
export const firebaseConfig = {
  apiKey: "AIzaSyDno0jjTwN1CaNCYOE0-_u25nEr5PaSqN4",
  authDomain: "persona-loop-de062.firebaseapp.com",
  projectId: "persona-loop-de062",
  storageBucket: "persona-loop-de062.firebasestorage.app",
  messagingSenderId: "238275802557",
  appId: "1:238275802557:web:405dfc9874121e28eb4ed4"
};

// 소유자 계정. 규칙에 고정된 최종 관리자로, allowlist가 비어도 잠기지 않는다.
// 나머지 관리자는 웹 설정 화면에서 추가/삭제하며 Firestore `admins` 컬렉션에 저장된다.
// ⚠️ 변경 시 firestore.rules의 isOwner() 이메일도 함께 수정할 것.
export const OWNER_EMAIL = "gihoon.mx@gmail.com";
