// The 学习 tab — pages/main/main.wxml LEARN block: 学院 (Academy: status card, learning paths,
// courses → lessons → player with quiz, certificates with the detail overlay, library) and
// 魔盒 (digital assets: audio player, video/other → open in a new tab, the device APK card).
// Mirrors main.js:_loadAcademy … downloadCert and _loadWellness … copyApkUrl. Library content
// comes from GET /academy/library/:id/content (the old web tab called the list route).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, q, clipboard } from '../api.js';
import { useApp } from '../store/AppContext.jsx';
import { ui } from '../components/ui/ui.js';

export default function LearnTab() {
  const app = useApp();
  const { user, lang, t, on } = app;
  const tl = t.training;
  const userId = user?.user_id;
  const [subTab, setSubTab] = useState('academy');

  // ── academy ──────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [courses, setCourses] = useState([]);
  const [library, setLibrary] = useState([]);
  const [completedIds, setCompletedIds] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [paths, setPaths] = useState([]);
  const [certs, setCerts] = useState([]);
  const [view, setView] = useState('list'); // list | lessons | player | library-viewer
  const [course, setCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [lesson, setLesson] = useState(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [textContent, setTextContent] = useState('');
  const [quiz, setQuiz] = useState([]);
  const [answers, setAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [quizReview, setQuizReview] = useState([]);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [marking, setMarking] = useState(false);
  const [libItem, setLibItem] = useState(null);
  const [libContent, setLibContent] = useState('');
  const [certDetail, setCertDetail] = useState(null);
  const loaded = useRef(false);

  const loadAcademy = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [cRes, lRes, pRes, dashRes, pathRes, certRes] = await Promise.allSettled([
        api.get('/academy/courses'), api.get('/academy/library'), api.get(`/academy/progress?user_id=${q(userId)}`),
        api.get(`/academy/coach-dashboard?user_id=${q(userId)}`), api.get('/academy/learning-paths'), api.get(`/academy/coach-certifications?user_id=${q(userId)}`),
      ]);
      const v = r => (r.status === 'fulfilled' ? r.value : null);
      const published = (v(cRes)?.courses || []).filter(c => c.status === 'published');
      const progressRows = v(pRes)?.progress || [];
      const byCourse = {};
      for (const p of progressRows) if (p.course_id) byCourse[p.course_id] = (byCourse[p.course_id] || 0) + 1;
      const completedCourseIds = new Set(published.filter(c => c.lesson_count > 0 && (byCourse[c.id] || 0) >= c.lesson_count).map(c => c.id));
      setCourses(published.map(c => ({ ...c, _lessonCountLabel: tl.lessonCount(c.lesson_count || 0), _locked: c.prerequisite_course_id ? !completedCourseIds.has(c.prerequisite_course_id) : false })));
      setLibrary(v(lRes)?.items || []);
      setCompletedIds(progressRows.map(p => p.lesson_id));
      setDashboard(v(dashRes) || null);
      setPaths((v(pathRes)?.paths || []).map(p => ({ ...p, _total: (p.courses || []).length, _done: (p.courses || []).filter(c => completedCourseIds.has(c.course_id)).length })));
      setCerts(v(certRes)?.certifications || []);
      loaded.current = true;
    } catch { ui.toast(tl.loadError); }
    setLoading(false);
  }, [userId, tl]);

  useEffect(() => on('tab:switch', tab => { if (tab === 'learn' && !loaded.current) loadAcademy(); }), [on, loadAcademy]);
  useEffect(() => { loaded.current = false; }, [userId, lang]);

  const openCourse = async c => {
    if (c._locked) { ui.toast(lang === 'zh' ? `请先完成：${c.prerequisite_title || '前置课程'}` : `Complete first: ${c.prerequisite_title || 'prerequisite course'}`, { duration: 2500 }); return; }
    setCourse(c); setLessons([]); setView('lessons');
    try { const res = await api.get(`/academy/lessons?course_id=${q(c.id)}`); setLessons(res?.lessons || []); } catch { ui.toast(tl.loadError); }
  };
  const openLesson = async l => {
    setLesson(l); setVideoUrl(''); setTextContent(''); setQuiz([]); setAnswers({}); setQuizResult(null); setQuizReview([]); setView('player');
    try {
      const detail = await api.get(`/academy/lessons/${q(l.id)}`);
      const qs = detail?.quiz_questions || [];
      if (l.content_type === 'text' || l.content_type === 'interactive') { setTextContent(detail?.lesson?.text_content || ''); setQuiz(qs); return; }
      if (l.oss_key) { const pre = await api.get(`/oss/presign?action=get&key=${q(l.oss_key)}`); setVideoUrl(pre?.url || ''); setQuiz(qs); }
    } catch { ui.toast(tl.loadError); }
  };
  const doMarkComplete = async lessonId => { if (completedIds.includes(lessonId)) return; try { await api.post('/academy/progress', { user_id: userId, lesson_id: lessonId }); setCompletedIds(ids => [...ids, lessonId]); } catch { /* silent */ } };
  const submitQuiz = async () => {
    if (!lesson) return;
    if (Object.keys(answers).length === 0) { ui.toast('请先回答问题'); return; }
    setQuizSubmitting(true);
    try {
      const result = await api.post('/academy/quiz-attempts', { user_id: userId, lesson_id: lesson.id, answers });
      setQuizReview(quiz.map(qn => { const ca = (result?.correct_answers || []).find(x => x.question_id === qn.id); return { question: qn.question, user_answer: ca ? (qn.options[answers[String(qn.id)]]?.text || '—') : '—', correct_answer: ca ? (qn.options[ca.correct_index]?.text || '') : '', explanation: ca?.explanation || '', is_correct: ca?.is_correct || false }; }));
      setQuizResult(result || {});
      if (result?.passed) { await doMarkComplete(lesson.id); loadAcademy(); }
    } catch { ui.toast(tl.loadError); }
    setQuizSubmitting(false);
  };
  const markComplete = async () => {
    if (!lesson) return;
    if (lesson.has_quiz && quiz.length > 0 && !quizResult?.passed) { ui.toast('请先完成测验'); return; }
    if (completedIds.includes(lesson.id)) return;
    setMarking(true);
    try { await doMarkComplete(lesson.id); ui.toast(tl.markedComplete); loadAcademy(); } catch { ui.toast(tl.loadError); }
    setMarking(false);
  };
  const openLibrary = async item => {
    setLibItem(item); setLibContent(''); setView('library-viewer');
    try { const res = await api.get(`/academy/library/${q(item.id)}/content`); setLibContent(typeof res === 'string' ? res : (res?.content || res?.text || '')); } catch { ui.toast(tl.loadError); }
  };
  const fmtCertDate = s => {
    if (!s) return ''; const d = new Date(s); if (Number.isNaN(d.getTime())) return s;
    const sh = new Date(d.getTime() + 8 * 3600 * 1000); const y = sh.getUTCFullYear(), day = sh.getUTCDate();
    if (lang === 'zh') return `${y}年${sh.getUTCMonth() + 1}月${day}日`;
    return `${['January','February','March','April','May','June','July','August','September','October','November','December'][sh.getUTCMonth()]} ${day}, ${y}`;
  };
  const showCert = async cert => {
    const key = cert.cert_oss_key || cert.template_image_oss_key;
    let templateImageUrl = '';
    if (key) { try { const res = await api.get(`/oss/presign?action=get&key=${q(key)}`); templateImageUrl = res?.url || ''; } catch { /* ignore */ } }
    setCertDetail({ ...cert, templateImageUrl, issueDateDisplay: fmtCertDate(cert.issue_date), expiryDateDisplay: fmtCertDate(cert.expiry_date) });
  };
  const downloadCert = async key => {
    if (!key) return;
    const win = window.open('', '_blank');
    try { const res = await api.get(`/oss/presign?action=get&key=${q(key)}`); if (!res?.url) throw new Error(); if (win) win.location.href = res.url; }
    catch { win?.close(); ui.toast(lang === 'zh' ? '下载失败' : 'Download failed'); }
  };
  const backToList = () => { setView('list'); setCourse(null); setLesson(null); setVideoUrl(''); setQuiz([]); setAnswers({}); setQuizResult(null); setQuizReview([]); };
  const backToLessons = () => { setView('lessons'); setLesson(null); setVideoUrl(''); setLibItem(null); setLibContent(''); setQuiz([]); setAnswers({}); setQuizResult(null); setQuizReview([]); };

  // ── 魔盒 ──────────────────────────────────────────────────────────────────
  const [wellnessLoading, setWellnessLoading] = useState(false);
  const [assets, setAssets] = useState([]);
  const [apk, setApk] = useState({ version: '', url: '' });
  const [track, setTrack] = useState(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef(null);
  const wellnessLoaded = useRef(false);
  const loadWellness = useCallback(async () => {
    setWellnessLoading(true);
    const cid = user?.channel_id;
    const [aRes, kRes] = await Promise.allSettled([api.get(`/digital-assets${cid ? `?channel_id=${q(cid)}` : ''}`), api.get('/kino-upgrade')]);
    const raw = aRes.status === 'fulfilled' ? (aRes.value?.assets || []) : [];
    setAssets(raw.map(a => ({ ...a, mediaType: (a.content_type || '').startsWith('audio/') ? 'audio' : (a.content_type || '').startsWith('video/') ? 'video' : 'other' })));
    const k = kRes.status === 'fulfilled' ? kRes.value : null;
    setApk({ version: k?.version || '', url: k?.url || '' });
    setWellnessLoading(false); wellnessLoaded.current = true;
  }, [user?.channel_id]);
  const playAudio = tr => {
    const a = audioRef.current; if (!a) return;
    if (track?.id === tr.id && playing) { a.pause(); return; }
    if (track?.id !== tr.id) { a.src = tr.url; setTrack(tr); }
    a.play().catch(() => {});
  };
  const stopAudio = () => { const a = audioRef.current; if (a) { a.pause(); a.currentTime = 0; } setTrack(null); setPlaying(false); };
  const openAsset = asset => { if (asset?.url) window.open(asset.url, '_blank', 'noopener'); };
  const durLabel = s => (s >= 60 ? `${Math.floor(s / 60)} 分钟` : `${s} 秒`);

  return (
    <div className="learn-tab">
      <div className="inner-tab-bar">
        <div className={`inner-tab${subTab === 'academy' ? ' inner-tab-active' : ''}`} onClick={() => { setSubTab('academy'); if (!loaded.current) loadAcademy(); }}><span className="inner-tab-text">{t.learnAcademyTab}</span></div>
        <div className={`inner-tab${subTab === 'wellness' ? ' inner-tab-active' : ''}`} onClick={() => { setSubTab('wellness'); if (!wellnessLoaded.current) loadWellness(); }}><span className="inner-tab-text">{t.learnBoxTab}</span></div>
      </div>
      {subTab === 'academy' ? (
        <div className="academy-subtab-scroll tab-scroll"><div className="training-tab">
          {loading ? <div className="loading-row"><span className="loading-text">{t.loading}</span></div>
          : view === 'list' ? (
            <>
              {dashboard && (
                <div className="academy-status-card">
                  <div className="academy-card-glow-tl" /><div className="academy-card-glow-br" />
                  <div className="academy-card-header"><span className="academy-card-header-label">{lang === 'zh' ? '学院状态' : 'ACADEMY STATUS'}</span><div className="academy-card-tier-badge"><span className="academy-card-tier-text">{dashboard.tier}</span></div></div>
                  <div className="academy-card-hero"><span className="academy-card-credits-num">{dashboard.total_credits}</span><span className="academy-card-credits-label">{lang === 'zh' ? '学分' : 'CREDITS'}</span></div>
                  <div className="academy-card-divider" />
                  <div className="academy-card-stats"><div className="academy-card-stat"><span className="academy-card-stat-num">{dashboard.completed_lessons}</span><span className="academy-card-stat-label">{lang === 'zh' ? '完成课程' : 'LESSONS'}</span></div><div className="academy-card-stat-sep" /><div className="academy-card-stat"><span className="academy-card-stat-num">{dashboard.certifications_count}</span><span className="academy-card-stat-label">{lang === 'zh' ? '证书' : 'CERTS'}</span></div></div>
                </div>
              )}
              {paths.length > 0 && <div className="training-section-header" style={{ marginTop: 12 }}><span className="training-section-title">{lang === 'zh' ? '学习路径' : 'Learning Paths'}</span></div>}
              {paths.map(p => (
                <div key={p.id} className="training-path-card" onClick={() => openCourse(p)}>
                  <div className="training-path-header"><span className="training-path-title">{p.title}</span><span className="training-path-tier">{p.tier}</span></div>
                  {p.description && <div className="training-path-desc"><span>{p.description}</span></div>}
                  <div className="training-path-progress-bar"><div className="training-path-progress-fill" style={{ width: `${p._total > 0 ? (p._done / p._total * 100) : 0}%` }} /></div>
                  <span className="training-path-progress-label">{p._done}/{p._total} {lang === 'zh' ? '课程' : 'courses'}</span>
                </div>
              ))}
              <div className="training-section-header" style={{ marginTop: 14 }}><span className="training-section-title">{tl.courses}</span></div>
              {courses.length === 0 && <div className="empty-state"><span className="empty-text">{tl.noTraining}</span></div>}
              {courses.map(c => (
                <div key={c.id} className={`training-course-card${c._locked ? ' training-course-card-locked' : ''}`} onClick={() => openCourse(c)}>
                  <div className="training-course-cover"><span className="training-course-cover-text">{c.title}</span><div className="training-lesson-badge"><span className="training-lesson-badge-text">{c._lessonCountLabel}</span></div>{c._locked && <div className="training-course-lock-badge"><span className="training-course-lock-icon">🔒</span></div>}</div>
                  <div className="training-course-body"><div className="training-course-meta">
                    <span className="training-course-title">{c.title}</span>{c.description && <span className="training-course-desc">{c.description}</span>}
                    <div className="training-course-meta-row"><span className="training-course-level">{c.level}</span><span className="training-course-credits">+{c.credit_value} {lang === 'zh' ? '学分' : 'cr'}</span></div>
                    {c._locked && c.prerequisite_title && <span className="training-course-prereq-hint">{lang === 'zh' ? '前置：' : 'Requires: '}{c.prerequisite_title}</span>}
                  </div></div>
                </div>
              ))}
              {certs.length > 0 && <div className="training-section-header" style={{ marginTop: 14 }}><span className="training-section-title">{lang === 'zh' ? '我的证书' : 'My Certifications'}</span></div>}
              {certs.map(c => <div key={c.id} className="training-cert-card" onClick={() => showCert(c)}><span className="training-cert-icon">🏅</span><div className="training-cert-info"><span className="training-cert-title">{c.title}</span>{c.tier && <span className="training-cert-tier">{c.tier}</span>}</div><span className="training-cert-chevron">›</span></div>)}
              <div className="training-section-header" style={{ marginTop: 14 }}><span className="training-section-title">{tl.library}</span></div>
              {library.length === 0 && <div className="empty-state"><span className="empty-text">{tl.noLibrary}</span></div>}
              {library.map(item => <div key={item.id} className="training-library-row" onClick={() => openLibrary(item)}><span className="training-library-icon">📄</span><span className="training-library-title">{item.title}</span><span className="training-library-chevron">›</span></div>)}
            </>
          ) : view === 'lessons' ? (
            <>
              <div className="training-back-row" onClick={backToList}><span className="training-back-text">{tl.backToCourses}</span></div>
              <div className="training-course-header"><span className="training-course-header-title">{course?.title}</span>{course?.description && <span className="training-course-header-desc">{course.description}</span>}<div className="training-course-meta-row" style={{ marginTop: 4 }}><span className="training-course-level">{course?.level}</span><span className="training-course-credits">+{course?.credit_value} {lang === 'zh' ? '学分' : 'cr'}</span></div></div>
              {lessons.length === 0 && <div className="empty-state" style={{ marginTop: 20 }}><span className="empty-text">{tl.noLessons}</span></div>}
              {lessons.map((l, i) => (
                <div key={l.id} className="training-lesson-row" onClick={() => openLesson(l)}>
                  <div className="training-lesson-num"><span className="training-lesson-num-text">{i + 1}</span></div>
                  <div className="training-lesson-info"><span className="training-lesson-title">{l.title}</span>{l.description && <span className="training-lesson-desc">{l.description}</span>}<div className="training-lesson-meta-row"><span className="training-lesson-type-badge">{l.content_type === 'video' ? '🎬' : l.content_type === 'text' ? '📄' : '🧩'}</span><span className="training-lesson-credits-label">+{l.credit_value} {lang === 'zh' ? '学分' : 'cr'}</span>{l.has_quiz && <span className="training-lesson-quiz-badge">📝 {lang === 'zh' ? '含测验' : 'Quiz'}</span>}</div></div>
                  {completedIds.includes(l.id) ? <div className="training-lesson-done"><span className="training-lesson-done-text">✓</span></div> : <span className="training-lesson-chevron">›</span>}
                </div>
              ))}
            </>
          ) : view === 'player' ? (
            <>
              <div className="training-back-row" onClick={backToLessons}><span className="training-back-text">{tl.backToLessons}</span></div>
              {(lesson?.content_type === 'video' || !lesson?.content_type) ? (
                <div className="training-video-container">{videoUrl ? <video className="training-video" src={videoUrl} controls playsInline /> : <div className="training-video-loading"><span className="training-video-loading-text">{t.loading}</span></div>}</div>
              ) : <div className="training-text-content"><span className="training-text-body">{textContent || t.loading}</span></div>}
              <div className="training-lesson-detail">
                <span className="training-lesson-detail-title">{lesson?.title}</span>{lesson?.description && <span className="training-lesson-detail-desc">{lesson.description}</span>}
                {quiz.length > 0 && (
                  <div className="training-quiz-section">
                    <span className="training-quiz-title">{lang === 'zh' ? '📝 课后测验' : '📝 Quiz'}</span>
                    {quizResult && (
                      <div className={`training-quiz-result ${quizResult.passed ? 'training-quiz-passed' : 'training-quiz-failed'}`}>
                        <span className="training-quiz-result-score">{quizResult.score}%</span>
                        <span className="training-quiz-result-label">{quizResult.passed ? (lang === 'zh' ? '通过！' : 'Passed!') : (lang === 'zh' ? '未通过，请重试' : 'Not passed, try again')}</span>
                        {quizResult.credits_earned > 0 && <span className="training-quiz-result-credits">+{quizResult.credits_earned} {lang === 'zh' ? '学分' : 'credits'}</span>}
                        {quizReview.length > 0 && <div className="training-quiz-review">{quizReview.map((r, i) => <div key={i} className={`training-quiz-review-item${r.is_correct ? ' training-quiz-review-correct' : ' training-quiz-review-wrong'}`}><span className="training-quiz-review-icon">{r.is_correct ? '✓' : '✗'}</span><div className="training-quiz-review-body"><span className="training-quiz-review-q">{r.question}</span>{!r.is_correct && <span className="training-quiz-review-your-ans">{lang === 'zh' ? '你的答案：' : 'Your answer: '}{r.user_answer}</span>}<span className="training-quiz-review-correct-ans">{lang === 'zh' ? '正确答案：' : 'Correct: '}{r.correct_answer}</span>{r.explanation && <span className="training-quiz-review-explanation">{r.explanation}</span>}</div></div>)}</div>}
                      </div>
                    )}
                    {(!quizResult || !quizResult.passed) && (
                      <>
                        {quiz.map((qn, i) => (
                          <div key={qn.id} className="training-quiz-question">
                            {qn.scenario && <span className="training-quiz-scenario">{qn.scenario}</span>}
                            <span className="training-quiz-q-text">{i + 1}. {qn.question}</span>
                            {qn.options.map((opt, oi) => <div key={oi} className={`training-quiz-option${answers[qn.id] === oi ? ' training-quiz-option-selected' : ''}`} onClick={() => setAnswers(a => ({ ...a, [qn.id]: oi }))}><div className={`training-quiz-option-radio${answers[qn.id] === oi ? ' training-quiz-option-radio-checked' : ''}`} /><span className="training-quiz-option-text">{opt.text}</span></div>)}
                          </div>
                        ))}
                        <div className={`training-quiz-submit-btn${quizSubmitting ? ' training-mark-btn-busy' : ''}`} onClick={submitQuiz}><span className="training-mark-btn-text">{quizSubmitting ? t.loading : (lang === 'zh' ? '提交答案' : 'Submit Answers')}</span></div>
                      </>
                    )}
                  </div>
                )}
                {completedIds.includes(lesson?.id) ? <div className="training-completed-badge"><span className="training-completed-badge-text">{tl.markedComplete}</span></div>
                  : (quiz.length === 0 || quizResult?.passed) ? <div className={`training-mark-btn${marking ? ' training-mark-btn-busy' : ''}`} onClick={markComplete}><span className="training-mark-btn-text">{marking ? t.loading : tl.markComplete}</span></div> : null}
              </div>
            </>
          ) : (
            <>
              <div className="training-back-row" onClick={backToList}><span className="training-back-text">{tl.backToCourses}</span></div>
              <div className="training-library-header"><span className="training-library-header-title">{libItem?.title}</span></div>
              <div className="training-library-content-scroll"><span className="training-library-content-text" style={{ whiteSpace: 'pre-wrap' }}>{libContent || t.loading}</span></div>
            </>
          )}
        </div></div>
      ) : (
        <div className="wellness-subtab-scroll tab-scroll">
          {wellnessLoading ? <div className="wellness-loading"><div className="pulse-dot" /><div className="pulse-dot" /><div className="pulse-dot" /></div> : (
            <div>
              {assets.length === 0 && !apk.url && <div className="wellness-empty" style={{ padding: '30px 14px' }}><span className="wellness-empty-text">{t.wellnessEmpty}</span></div>}
              {assets.map(item => (
                <div key={item.id} className="wellness-section" style={{ paddingBottom: 0 }}>
                  {item.mediaType === 'audio' ? (
                    <div className="sleep-track-card" onClick={() => playAudio(item)}><div className="sleep-track-icon"><span className="sleep-icon-glyph">{track?.id === item.id && playing ? '⏸' : '▶'}</span></div><div className="sleep-track-info"><span className="sleep-track-name">{item.title_zh || item.title}</span>{item.duration_seconds && <span className="sleep-track-dur">{durLabel(item.duration_seconds)}</span>}</div>{track?.id === item.id && <div className="sleep-track-active-dot" />}</div>
                  ) : (
                    <div className="media-asset-card" onClick={() => openAsset(item)}><div className={`media-asset-icon media-asset-icon--${item.mediaType === 'video' ? 'video' : 'doc'}`}><span className="media-asset-glyph">{item.mediaType === 'video' ? '▶' : '↓'}</span></div><div className="media-asset-info"><span className="media-asset-name">{item.title_zh || item.title}</span>{item.mediaType === 'video' && item.duration_seconds && <span className="media-asset-sub">{durLabel(item.duration_seconds)}</span>}</div><div className="media-asset-btn"><span className="media-asset-btn-text">{t.wellnessOpenLink}</span></div></div>
                  )}
                </div>
              ))}
              {apk.url && <div className="wellness-section" style={{ paddingBottom: 0 }}><div className="media-asset-card" onClick={async () => { if (await clipboard.write(apk.url)) ui.toast('链接已复制，请在浏览器打开', { duration: 2500 }); }}><div className="media-asset-icon media-asset-icon--doc"><span className="media-asset-glyph">↓</span></div><div className="media-asset-info"><span className="media-asset-name">Kino APK {apk.version}</span></div><div className="media-asset-btn"><span className="media-asset-btn-text">{t.wellnessOpenLink}</span></div></div></div>}
              {track && <div className="sleep-now-playing" style={{ margin: '8px 14px 0' }}><div className="sleep-np-info"><span className="sleep-np-label">{t.nowPlaying}</span><span className="sleep-np-title">{track.title_zh || track.title}</span></div><div className="sleep-np-controls"><div className="sleep-np-btn" onClick={stopAudio}><span className="sleep-np-btn-icon">⏹</span></div></div></div>}
            </div>
          )}
          <audio ref={audioRef} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} style={{ display: 'none' }} />
        </div>
      )}
      {certDetail && (
        <div className="cert-overlay" onClick={() => setCertDetail(null)}>
          <div className="cert-detail-card" onClick={e => e.stopPropagation()}>
            <div className="cert-detail-header"><div className="cert-status-badge"><span className="cert-status-check">✓</span><span className="cert-status-text">{lang === 'zh' ? '证书有效' : 'Certificate Valid'}</span></div><div className="cert-close-btn" onClick={() => setCertDetail(null)}>✕</div></div>
            {certDetail.templateImageUrl && <div className="cert-bg-wrap"><img src={certDetail.templateImageUrl} className="cert-bg-preview" alt="" /></div>}
            <div className="cert-field-list">
              {[[lang === 'zh' ? '姓名' : 'Name', certDetail._userName || user?.nickname || '—'], [lang === 'zh' ? '学员编号' : 'Student ID', certDetail.user_id || '—', 'cert-mono'],
                certDetail.course_display_name && [lang === 'zh' ? '课程名称' : 'Course', certDetail.course_display_name], [lang === 'zh' ? '证书名称' : 'Certificate', certDetail.title],
                certDetail.certificate_number && [lang === 'zh' ? '证书编号' : 'Cert No.', certDetail.certificate_number, 'cert-mono cert-number'], certDetail.assessment_period && [lang === 'zh' ? '考核时间' : 'Assessment', certDetail.assessment_period],
                certDetail.score != null && [lang === 'zh' ? '考试分数' : 'Score', certDetail.score], [lang === 'zh' ? '证书状态' : 'Status', lang === 'zh' ? '有效' : 'Valid', 'cert-valid'],
                certDetail.issuing_org && [lang === 'zh' ? '颁发机构' : 'Issuing Org', certDetail.issuing_org], certDetail.school_org && [lang === 'zh' ? '办学机构' : 'Institute', certDetail.school_org],
                certDetail.issueDateDisplay && [lang === 'zh' ? '颁发时间' : 'Issue Date', certDetail.issueDateDisplay], certDetail.expiryDateDisplay && [lang === 'zh' ? '有效期至' : 'Expires', certDetail.expiryDateDisplay],
              ].filter(Boolean).map(([label, val, cls]) => <div key={label} className="cert-field"><span className="cert-label">{label}</span><span className={`cert-value${cls ? ' ' + cls : ''}`}>{val}</span></div>)}
            </div>
            {certDetail.cert_oss_key && <div className="cert-download-btn" onClick={() => downloadCert(certDetail.cert_oss_key)}><span>↓ {lang === 'zh' ? '下载电子证书' : 'Download Certificate'}</span></div>}
          </div>
        </div>
      )}
    </div>
  );
}
