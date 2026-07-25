// Persona Loop — 응답자 프로필 (M02)
//
// 응답 문서 1건 = 응답자 1명. 이 파일은 "문항별 집계"가 아니라 "이 사람이 문항 전체에
// 어떻게 답했는가"를 만드는 순수 로직만 담는다 (ARCHITECTURE.md §5).
// DOM·Firebase에 의존하지 않는다 — 그래야 화면 없이도 검증할 수 있다
// (tools/verify-personas.mjs가 이 함수들을 그대로 불러 쓴다).
//
// 개인정보: 실명·계정(uid)은 다루지 않는다. 회차 안에서만 유효한 익명 라벨만 쓴다.

export function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return String(v).trim() === '';
}

/** 'P2'가 'P10'보다 앞에 오도록 숫자를 숫자로 비교한다. */
export function natCompare(a, b) {
  return String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' });
}

/** submittedAt은 Firestore Timestamp · ISO 문자열 · null이 모두 올 수 있다. */
export function toDateOrNull(v) {
  if (!v) return null;
  if (typeof v === 'object' && typeof v.toDate === 'function') {
    try { return v.toDate(); } catch { return null; }
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 연동 서베이는 항목별 자유 의견을 `<qid>-c` 주관식 문항으로 따로 담는다 (survey-source.js). */
export function commentQidOf(qid) { return `${qid}-c`; }

/**
 * 응답자 1명의 답변을 문항 순서대로 편다 (answerProfile.answers의 원형).
 * - `<qid>-c` 의견 문항은 별도 행이 아니라 원 문항의 comment로 접는다.
 *   단 안내 페이지처럼 원 문항이 없는 의견은 그대로 한 행이 된다 — 그 의견도 사람의 목소리다.
 * - 무응답 문항도 행으로 남긴다 (answer: null). 무엇을 답하지 않았는지도 정보다.
 */
export function buildProfileRows(questions, answers) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const rows = [];
  for (const q of questions) {
    if (q.id.endsWith('-c') && byId.has(q.id.slice(0, -2))) continue;  // 원 문항에 접힌다
    const cq = byId.get(commentQidOf(q.id));
    const rawA = answers ? answers[q.id] : undefined;
    const rawC = cq && answers ? answers[cq.id] : undefined;
    rows.push({
      question: q,
      answer: isBlank(rawA) ? null : rawA,
      comment: isBlank(rawC) ? '' : String(rawC).trim(),
    });
  }
  return rows;
}

/** 응답 문서 1건 → 화면·내보내기에 쓰는 응답자 프로필. */
export function summarizeRespondent(questions, doc) {
  const answers = doc.answers || {};
  const rows = buildProfileRows(questions, answers);
  const answered = rows.filter((r) => r.answer !== null).length;
  // 자유 의견 = 주관식 문항에 실제로 남긴 글. 연동 서베이의 `-c` 의견도 주관식이라 여기 포함된다.
  const texts = questions
    .filter((q) => q.type === 'open')
    .map((q) => answers[q.id])
    .filter((v) => !isBlank(v))
    .map((v) => String(v).trim());
  const preview = texts.reduce((longest, t) => (t.length > longest.length ? t : longest), '');
  // 정의에 없는 문항 키 — 문항이 나중에 바뀐 경우를 조용히 숨기지 않는다.
  const known = new Set(questions.map((q) => q.id));
  const orphanKeys = Object.keys(answers).filter((k) => !known.has(k) && !isBlank(answers[k]));
  return {
    rows, answered, total: rows.length,
    ratio: rows.length ? answered / rows.length : 0,
    commentCount: texts.length, preview, orphanKeys,
  };
}

/** 응답 배열 → 결정적 순서의 응답자 목록. 순번('#3')이 새로고침마다 흔들리지 않게 정렬을 고정한다. */
export function buildRespondents(questions, responses) {
  const ordered = [...responses].sort((a, b) => {
    const la = a.respondentLabel || '', lb = b.respondentLabel || '';
    if (la && lb) return natCompare(la, lb);
    if (la !== lb) return la ? -1 : 1;                       // 라벨이 있는 응답을 앞에
    const ta = toDateOrNull(a.submittedAt), tb = toDateOrNull(b.submittedAt);
    if (ta && tb && ta.getTime() !== tb.getTime()) return ta - tb;
    if (!!ta !== !!tb) return ta ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  return ordered.map((doc, i) => ({
    doc,
    index: i + 1,
    label: doc.respondentLabel || `응답 #${i + 1}`,
    key: doc.respondentLabel || `#${i + 1}`,   // URL의 &r= 값
    ...summarizeRespondent(questions, doc),
  }));
}

/**
 * 라벨·순번·문서 id 중 무엇으로도 응답자를 찾는다.
 * 라벨이 없는 응답은 화면 표기가 '응답 #3'이고 URL 값은 '#3'인데, 내보낸 프로필의
 * `respondentLabel`에는 표기 쪽('응답 #3')이 들어간다. 그 값을 페르소나 근거에 적어 두고
 * 다시 되짚을 때 찾히지 않으면 v0.5의 추적성이 거기서 끊기므로 둘 다 받아들인다.
 */
export function findRespondent(list, key) {
  if (!key) return null;
  const raw = String(key).trim();
  const m = raw.match(/^(?:응답\s*)?#?(\d+)$/);
  const n = m ? Number(m[1]) : NaN;
  return list.find((r) => r.key === raw)
    || list.find((r) => r.label === raw)
    || (Number.isFinite(n) ? list.find((r) => r.index === n) : null)
    || list.find((r) => r.doc.id === raw)
    || null;
}

/** persona.schema.json의 answerProfile 형태 — M05 이전에는 이 파일이 에이전트의 입력이 된다. */
export function buildAnswerProfile(sid, r) {
  return {
    surveyId: sid,
    respondentLabel: r.label,
    answers: r.rows.map((row) => {
      const out = {
        questionId: row.question.id,
        questionText: row.question.text || '',
        answer: row.answer,            // 무응답은 null로 남긴다 (빠뜨리지 않는다)
      };
      if (row.comment) out.comment = row.comment;
      return out;
    }),
  };
}
