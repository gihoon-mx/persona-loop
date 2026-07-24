#!/usr/bin/env bash
# Firestore 보안 규칙 검증 — 비로그인(익명) 상태에서 무엇이 열려 있는지 확인한다.
# 규칙을 콘솔에 게시한 직후 실행할 것.
#   사용법: bash tools/check-rules.sh [projectId] [surveyId]
set -u

API_KEY="AIzaSyDno0jjTwN1CaNCYOE0-_u25nEr5PaSqN4"
FS="https://firestore.googleapis.com/v1/projects/persona-loop-de062/databases/(default)/documents"
PID="${1:-sample}"
SID="${2:-sv-sample}"

pass=0; fail=0

# probe <설명> <기대: deny|allow> <경로>
probe() {
  local desc="$1" expect="$2" path="$3"
  local body; body=$(curl -s -m 15 "${FS}/${path}?key=${API_KEY}")
  local got="allow"
  echo "$body" | grep -q "PERMISSION_DENIED" && got="deny"
  # 존재하지 않는 문서(404)는 규칙을 통과했다는 뜻이므로 allow로 본다
  if [ "$got" = "$expect" ]; then
    printf "  ✅ %-46s (%s)\n" "$desc" "$got"; pass=$((pass+1))
  else
    printf "  ❌ %-46s 기대=%s 실제=%s\n" "$desc" "$expect" "$got"; fail=$((fail+1))
  fi
}

echo "비로그인 상태 접근 검증 (project=${PID}, survey=${SID})"
echo
echo "[비공개여야 하는 것]"
probe "프로젝트 목록"          deny  "projects"
probe "프로젝트 문서"          deny  "projects/${PID}"
probe "서베이 목록"            deny  "projects/${PID}/surveys"
probe "서베이 문서(정의+집계)" deny  "projects/${PID}/surveys/${SID}"
probe "응답 원본"              deny  "projects/${PID}/surveys/${SID}/responses"
probe "페르소나"               deny  "projects/${PID}/personas"
probe "리뷰"                   deny  "projects/${PID}/reviews"
probe "사용 세션"              deny  "projects/${PID}/sessions"
probe "관리자 목록"            deny  "admins"
probe "공개 폼 목록(list)"     deny  "projects/${PID}/public-forms"

echo
echo "[공개 예외 — public-forms 문서만, 그것도 문항까지만]"
body=$(curl -s -m 15 "${FS}/projects/${PID}/public-forms/${SID}?key=${API_KEY}")
if echo "$body" | grep -q "PERMISSION_DENIED"; then
  echo "  ℹ️  공개 폼 ${SID}: 차단됨 — 서베이가 '진행 중'이 아니면 정상입니다."
elif echo "$body" | grep -q '"error"'; then
  echo "  ℹ️  공개 폼 ${SID}: 문서 없음 — 서베이가 '진행 중'이 아니면 정상입니다."
else
  echo "  ✅ 공개 폼 ${SID}: 열려 있음 (응답 링크 배포용으로 의도된 동작)"
  # 공개 문서에 응답 데이터가 섞여 들어가지 않았는지 확인 — 가장 중요한 검사
  leaked=0
  for forbidden in aggregates responseCount responses answers; do
    if echo "$body" | grep -q "\"${forbidden}\""; then
      printf "  ❌ 공개 폼에 '%s' 필드가 포함됨 — 응답 데이터 노출!\n" "$forbidden"
      leaked=1; fail=$((fail+1))
    fi
  done
  [ "$leaked" -eq 0 ] && { echo "  ✅ 노출 필드 확인: 응답·집계 데이터 없음"; pass=$((pass+1)); }
fi

echo
echo "통과 ${pass} · 실패 ${fail}"
[ "$fail" -eq 0 ] || exit 1
