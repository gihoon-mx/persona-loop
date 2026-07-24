// Firebase 웹 config. 콘솔(프로젝트 설정 > 내 앱)에서 복사한 객체를 아래에 붙여넣으면 활성화된다.
// 이 값들은 공개되어도 안전 (도메인 제한 + Firestore rules가 실제 보호막). null이면 앱은 읽기 전용 정적 모드로 동작.
export const firebaseConfig = null;
/* 예시:
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "persona-loop.firebaseapp.com",
  projectId: "persona-loop",
  storageBucket: "persona-loop.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
*/

// 관리 콘솔 접근 허용 이메일 (Firestore rules의 allowlist와 일치시켜야 함)
export const adminEmails = ["gihoon.mx@gmail.com"];
