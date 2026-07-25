#!/usr/bin/env node
// 페르소나 교차 검증 — v0.5의 "페르소나는 개인 응답에서 나온다"가 실제로 지켜지는지 검사한다.
//
//   node tools/verify-personas.mjs
//
// 이 스크립트는 빌더의 자기 보고를 믿지 않고 파일만 본다. 검사 항목:
//   1. 집계 무결성   — 응답 원본을 다시 집계한 값이 서베이 문서의 aggregates와 같은가
//   2. 근거 무결성   — 모든 evidence에 respondentLabel이 있고, questionId·라벨이 실존하는가
//   3. 인용 대조     — evidence의 quote가 그 응답자가 실제로 낸 답과 어긋나지 않는가
//   4. 응답 프로필   — answerProfile이 그 응답자의 실제 응답과 일치하는가
//   5. 렌더 경로     — 라벨 없는 응답·복수 선택·무응답이 화면 로직에서 제대로 처리되는가
//   6. 내보내기 형식 — 화면이 내보내는 JSON이 persona.schema.json의 answerProfile과 맞는가
//   7. 대표성 수치   — populationNote·populationContext의 'N명' 주장이 응답에서 재현되는가
//
// M05(persona-builder)가 붙은 뒤에도 생성 결과를 이 스크립트로 통과시킨 다음 저장한다.

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildRespondents, findRespondent, buildAnswerProfile, isBlank,
} from '../packages/core/respondent-profile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'data/seed/sample');

const problems = [];
const notes = [];
let checks = 0;
const fail = (where, msg) => problems.push(`${where}: ${msg}`);
const ok = () => { checks += 1; };
const check = (cond, where, msg) => { ok(); if (!cond) fail(where, msg); };

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

// ---------- 입력 ----------
const survey = await readJson(path.join(SEED, 'surveys/sv-sample.json'));
const responseFile = await readJson(path.join(SEED, 'responses/sv-sample.json'));
const responses = responseFile.responses;
const personaFiles = (await readdir(path.join(SEED, 'personas'))).filter((f) => f.endsWith('.json'));
const personas = await Promise.all(personaFiles.map((f) => readJson(path.join(SEED, 'personas', f))));

const questions = survey.questions;
const qById = new Map(questions.map((q) => [q.id, q]));
// 화면이 쓰는 것과 똑같은 함수로 응답자 목록을 만든다 (렌더 경로를 그대로 검증하기 위해).
const respondents = buildRespondents(questions, responses);
const byLabel = new Map(respondents.map((r) => [r.label, r]));

// ---------- 1. 집계 무결성 ----------
{
  const W = '집계';
  const agg = survey.aggregates;
  check(!!agg, W, 'aggregates가 없다');
  check(agg.responseCount === responses.length, W,
    `aggregates.responseCount=${agg?.responseCount} 인데 응답 문서는 ${responses.length}건`);
  check(survey.responseCount === responses.length, W,
    `서베이 responseCount=${survey.responseCount} 인데 응답 문서는 ${responses.length}건`);

  for (const q of questions) {
    const stored = agg.byQuestion?.[q.id];
    if (!stored) { fail(W, `${q.id}: aggregates에 항목이 없다`); continue; }
    const vals = responses.map((r) => r.answers?.[q.id]).filter((v) => !isBlank(v));
    if (q.type === 'open') {
      const got = [...vals.map(String)].sort();
      const want = [...(stored.answers || [])].sort();
      check(JSON.stringify(got) === JSON.stringify(want), W,
        `${q.id}: 주관식 응답이 aggregates와 다르다 (응답 ${got.length}건 / 집계 ${want.length}건)`);
    } else {
      const counts = {};
      for (const v of vals) for (const x of Array.isArray(v) ? v : [v]) counts[String(x)] = (counts[String(x)] || 0) + 1;
      const norm = (o) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
      check(norm(counts) === norm(stored.counts || {}), W,
        `${q.id}: 선택 분포가 aggregates와 다르다\n    응답=${norm(counts)}\n    집계=${norm(stored.counts || {})}`);
      if (stored.mean !== undefined && stored.mean !== null) {
        const ns = vals.filter((v) => typeof v === 'number');
        const mean = Math.round((ns.reduce((a, b) => a + b, 0) / ns.length) * 10) / 10;
        check(mean === stored.mean, W, `${q.id}: mean=${stored.mean} 인데 응답에서 계산하면 ${mean}`);
      }
    }
  }
}

// ---------- 2~4. 페르소나별 검사 ----------
/** evidencedItem이 놓인 모든 위치를 훑는다 (traits·goals·painPoints·behaviorModel 전부). */
function* evidencedItems(p) {
  for (const key of ['traits', 'goals', 'painPoints']) {
    for (const [i, it] of (p[key] || []).entries()) yield [`${key}[${i}]`, it];
  }
  const bm = p.behaviorModel || {};
  for (const key of ['firstMoves', 'decisionDrivers', 'dealBreakers']) {
    for (const [i, it] of (bm[key] || []).entries()) yield [`behaviorModel.${key}[${i}]`, it];
  }
  if (bm.successMoment) yield ['behaviorModel.successMoment', bm.successMoment];
}

for (const p of personas) {
  const W0 = p.id;

  // --- 스키마 필수 필드
  for (const f of ['id', 'projectId', 'name', 'summary', 'basis', 'sourceRespondents',
    'answerProfile', 'traits', 'behaviorModel', 'voice']) {
    check(p[f] !== undefined, W0, `필수 필드 누락: ${f}`);
  }
  const bm = p.behaviorModel || {};
  for (const f of ['firstMoves', 'decisionDrivers', 'dealBreakers']) {
    check(Array.isArray(bm[f]) && bm[f].length >= 1, W0, `behaviorModel.${f}가 비어 있다`);
  }
  if (bm.effortTolerance !== undefined) {
    check(['low', 'mid', 'high'].includes(bm.effortTolerance), W0,
      `effortTolerance 값이 스키마 밖: ${bm.effortTolerance}`);
  }
  if (bm.helpSeeking !== undefined) {
    check(['never', 'rarely', 'often'].includes(bm.helpSeeking), W0,
      `helpSeeking 값이 스키마 밖: ${bm.helpSeeking}`);
  }

  // --- sourceRespondents가 실제 응답자인가 / primary는 하나인가
  const primaries = (p.sourceRespondents || []).filter((s) => s.role === 'primary');
  check(primaries.length === 1, W0,
    `primary 응답자는 정확히 1명이어야 한다 (현재 ${primaries.length}명) — 여러 명을 평균 내면 집계 페르소나로 되돌아간다`);
  for (const s of p.sourceRespondents || []) {
    check(!!byLabel.get(s.respondentLabel), `${W0}.sourceRespondents`,
      `응답자 '${s.respondentLabel}'가 응답 원본에 없다`);
  }
  if (p.clusterSize !== undefined) {
    check(p.clusterSize === (p.sourceRespondents || []).length, W0,
      `clusterSize=${p.clusterSize} 인데 sourceRespondents는 ${(p.sourceRespondents || []).length}명`);
  }
  check(p.basis !== 'individual' || (p.sourceRespondents || []).length === 1, W0,
    `basis=individual 인데 sourceRespondents가 ${(p.sourceRespondents || []).length}명`);

  // --- 2. 근거 무결성 + 3. 인용 대조
  for (const [where, item] of evidencedItems(p)) {
    const W = `${W0}.${where}`;
    check(!!item.text, W, 'text가 없다');
    check(Array.isArray(item.evidence) && item.evidence.length >= 1, W, 'evidence가 없다');
    for (const [j, ev] of (item.evidence || []).entries()) {
      const EW = `${W}.evidence[${j}]`;
      check(!!ev.respondentLabel, EW, 'respondentLabel이 없다 (집계 인용은 근거가 될 수 없다)');
      check(!!ev.questionId, EW, 'questionId가 없다');
      check(qById.has(ev.questionId), EW, `questionId '${ev.questionId}'가 서베이에 없다`);
      check((p.sourceSurveyIds || [survey.id]).includes(ev.surveyId), EW,
        `surveyId '${ev.surveyId}'가 sourceSurveyIds에 없다`);

      const r = byLabel.get(ev.respondentLabel);
      check(!!r, EW, `응답자 '${ev.respondentLabel}'가 응답 원본에 없다`);
      if (!r || !qById.has(ev.questionId)) continue;

      // 근거로 지목한 응답자가 그 문항에 실제로 답했는가 (의견 문항은 원 문항에 접힌다)
      const row = r.rows.find((x) => x.question.id === ev.questionId);
      const answered = row && (row.answer !== null || row.comment);
      check(!!answered, EW,
        `${ev.respondentLabel}는 ${ev.questionId}에 답하지 않았다 — 없는 답을 근거로 삼았다`);

      // 인용에 등장하는 선택지가 그 사람이 고른 값과 어긋나지 않는가
      const q = qById.get(ev.questionId);
      if (answered && ev.quote && Array.isArray(q.options) && q.options.length) {
        const picked = new Set(Array.isArray(row.answer) ? row.answer.map(String)
          : row.answer === null ? [] : [String(row.answer)]);
        for (const opt of q.options) {
          // 인용에 선택지 이름이 나오는데 그 사람이 고르지 않았다면, 부정 표현('고르지 않음')이
          // 함께 있어야 한다. 없으면 사실과 다른 인용이다.
          if (!ev.quote.includes(opt) || picked.has(opt)) continue;
          const negated = /고르지 않|선택하지 않|안 골|제외|빼|없음|아니/.test(ev.quote);
          check(negated, EW,
            `${ev.respondentLabel}는 '${opt}'를 고르지 않았는데 인용에 그대로 들어 있다: "${ev.quote}"`);
        }
      }
      // 리커트 인용의 숫자가 실제 점수와 같은가 ("5 — 매우 그렇다")
      if (answered && ev.quote && q.type === 'likert' && typeof row.answer === 'number') {
        const m = ev.quote.match(/^\s*(\d)/);
        if (m) check(Number(m[1]) === row.answer, EW,
          `${ev.respondentLabel}의 ${ev.questionId} 응답은 ${row.answer}점인데 인용은 "${ev.quote}"`);
      }
    }
  }

  // --- 4. answerProfile ↔ 실제 응답
  const ap = p.answerProfile || {};
  const WA = `${W0}.answerProfile`;
  const primaryLabel = primaries[0]?.respondentLabel;
  check(ap.respondentLabel === primaryLabel, WA,
    `중심 응답자(${primaryLabel})와 answerProfile의 응답자(${ap.respondentLabel})가 다르다`);
  const pr = byLabel.get(ap.respondentLabel);
  if (pr) {
    // 화면의 내보내기와 같은 함수로 만든 프로필을 정답으로 삼아 대조한다.
    const truth = buildAnswerProfile(ap.surveyId || survey.id, pr);
    const truthById = new Map(truth.answers.map((a) => [a.questionId, a]));
    check(ap.answers.length === truth.answers.length, WA,
      `문항 수가 다르다: 페르소나 ${ap.answers.length}개 / 실제 프로필 ${truth.answers.length}개`);
    for (const a of ap.answers) {
      const t = truthById.get(a.questionId);
      if (!t) { fail(WA, `${a.questionId}: 실제 프로필에 없는 문항`); continue; }
      ok();
      const same = JSON.stringify(a.answer) === JSON.stringify(t.answer);
      if (!same) fail(WA, `${a.questionId}: answer 불일치\n    페르소나=${JSON.stringify(a.answer)}\n    응답원본=${JSON.stringify(t.answer)}`);
      ok();
      if ((a.comment || '') !== (t.comment || '')) {
        fail(WA, `${a.questionId}: comment 불일치\n    페르소나=${JSON.stringify(a.comment || '')}\n    응답원본=${JSON.stringify(t.comment || '')}`);
      }
      ok();
      if (a.questionText !== t.questionText) {
        fail(WA, `${a.questionId}: questionText가 서베이 문항과 다르다`);
      }
    }
    // confidence.answeredRatio는 실제 응답률과 맞아야 한다
    if (p.confidence?.answeredRatio !== undefined) {
      const actual = Math.round(pr.ratio * 100) / 100;
      check(Math.abs(actual - p.confidence.answeredRatio) < 0.01, W0,
        `confidence.answeredRatio=${p.confidence.answeredRatio} 인데 실제 응답률은 ${actual} (${pr.answered}/${pr.total})`);
    }
  }

  // --- 7. 대표성 수치: "N명" 주장이 응답에서 재현되는가
  const claims = [];
  if (p.populationNote) claims.push(['populationNote', p.populationNote]);
  for (const [where, item] of evidencedItems(p)) {
    for (const [j, ev] of (item.evidence || []).entries()) {
      if (ev.populationContext) claims.push([`${where}.evidence[${j}].populationContext`, ev.populationContext]);
    }
  }
  for (const [where, text] of claims) {
    // '35명 중 N명' 꼴에서 총원이 실제 응답 수와 같은지만 기계적으로 본다.
    for (const m of text.matchAll(/(\d+)\s*명\s*중/g)) {
      check(Number(m[1]) === responses.length, `${W0}.${where}`,
        `'${m[1]}명 중'이라고 적혀 있으나 응답은 ${responses.length}건이다`);
    }
    // 어떤 주장이든 응답 수보다 큰 인원은 나올 수 없다.
    for (const m of text.matchAll(/(\d+)\s*명/g)) {
      check(Number(m[1]) <= responses.length, `${W0}.${where}`,
        `${m[1]}명은 전체 응답 ${responses.length}건보다 많다`);
    }
  }
}

// ---------- 5. 렌더 경로 ----------
{
  const W = '렌더';
  const unlabeled = respondents.filter((r) => !r.doc.respondentLabel);
  check(unlabeled.length > 0, W, '라벨 없는 응답이 샘플에 없어 "응답 #n" 경로가 검증되지 않는다');
  for (const r of unlabeled) {
    check(/^응답 #\d+$/.test(r.label), W, `라벨 없는 응답의 표기가 예상과 다르다: ${r.label}`);
    // 내보낸 프로필의 respondentLabel('응답 #3')로 다시 찾아갈 수 있어야 추적성이 끊기지 않는다.
    check(findRespondent(respondents, r.label) === r, W,
      `내보낸 라벨 '${r.label}'로 응답자를 되짚을 수 없다 (근거 추적이 끊긴다)`);
    check(findRespondent(respondents, r.key) === r, W, `URL 값 '${r.key}'로 응답자를 찾을 수 없다`);
  }
  // 라벨 있는 응답은 라벨로 찾아진다
  for (const r of respondents.filter((x) => x.doc.respondentLabel)) {
    check(findRespondent(respondents, r.label) === r, W, `라벨 '${r.label}'로 찾을 수 없다`);
  }
  // 정렬이 결정적인가 (같은 입력을 섞어 넣어도 같은 순번이 나오는가)
  const shuffled = [...responses].reverse();
  const again = buildRespondents(questions, shuffled);
  check(JSON.stringify(again.map((r) => r.label)) === JSON.stringify(respondents.map((r) => r.label)),
    W, '입력 순서가 바뀌면 응답자 순번이 흔들린다 (라벨 없는 응답의 "#n"이 불안정해진다)');
  // 라벨 있는 응답이 앞에 오는가
  const firstUnlabeled = respondents.findIndex((r) => !r.doc.respondentLabel);
  const lastLabeled = respondents.reduce((acc, r, i) => (r.doc.respondentLabel ? i : acc), -1);
  check(firstUnlabeled === -1 || firstUnlabeled > lastLabeled, W, '라벨 없는 응답이 라벨 있는 응답보다 앞에 있다');

  // 복수 선택·무응답·의견 접힘
  const multiQ = questions.find((q) => q.type === 'multi');
  if (multiQ) {
    const withMulti = respondents.filter((r) => {
      const row = r.rows.find((x) => x.question.id === multiQ.id);
      return Array.isArray(row?.answer) && row.answer.length > 1;
    });
    check(withMulti.length > 0, W, '복수 선택 응답이 샘플에 없어 배열 렌더 경로가 검증되지 않는다');
  }
  const withBlank = respondents.filter((r) => r.rows.some((x) => x.answer === null));
  check(withBlank.length > 0, W, '무응답이 샘플에 없어 "무응답" 렌더 경로가 검증되지 않는다');
  const withComment = respondents.filter((r) => r.rows.some((x) => x.comment));
  check(withComment.length > 0, W, '문항별 의견이 샘플에 없어 -c 접힘 경로가 검증되지 않는다');
  // -c 문항은 별도 행으로 새지 않는다
  for (const r of respondents) {
    check(!r.rows.some((x) => x.question.id.endsWith('-c')), W,
      `${r.label}: 의견 문항(-c)이 별도 행으로 남아 있다 — 원 문항에 접혀야 한다`);
    check(r.orphanKeys.length === 0, W,
      `${r.label}: 문항 정의에 없는 응답 키가 있다: ${r.orphanKeys.join(', ')}`);
  }
}

// ---------- 6. 내보내기 형식 ----------
{
  const W = '내보내기';
  for (const r of respondents) {
    const prof = buildAnswerProfile(survey.id, r);
    check(typeof prof.surveyId === 'string' && !!prof.respondentLabel, W, 'surveyId·respondentLabel 누락');
    check(prof.answers.length === r.rows.length, W, `${r.label}: 내보낸 문항 수가 프로필 행 수와 다르다`);
    for (const a of prof.answers) {
      // answerProfile.answers의 required는 questionId·questionText·answer.
      // 무응답은 값을 빼지 않고 null로 남겨야 한다 (키가 없으면 스키마 위반).
      check('questionId' in a && 'questionText' in a && 'answer' in a, W,
        `${r.label}/${a.questionId}: required 필드가 빠졌다`);
    }
  }
  notes.push(`내보내기 형식: 응답자 ${respondents.length}명 전원의 프로필이 answerProfile 필수 필드를 만족`);
}

// ---------- 결과 ----------
const cluster = respondents.filter((r) => {
  const q3 = r.doc.answers?.q3;
  return Array.isArray(q3) && q3.length === 1 && q3[0] === '길찾기' && r.doc.answers?.q2 <= 2;
});
notes.push(`응답자 ${respondents.length}명 (라벨 있음 ${respondents.filter((r) => r.doc.respondentLabel).length} / 없음 ${respondents.filter((r) => !r.doc.respondentLabel).length})`);
notes.push(`페르소나 ${personas.length}건: ${personas.map((p) => `${p.id}(${p.basis})`).join(', ')}`);
notes.push(`참고 교차표 — 길찾기만 ∩ q2≤2: ${cluster.length}명 (${cluster.map((r) => r.label).join(', ')})`);

console.log(notes.map((n) => `· ${n}`).join('\n'));
console.log(`\n검사 ${checks}건 수행.`);
if (problems.length) {
  console.error(`\n❌ 문제 ${problems.length}건\n`);
  problems.forEach((p, i) => console.error(`${i + 1}. ${p}`));
  process.exit(1);
}
console.log('✅ 모든 검사 통과');
