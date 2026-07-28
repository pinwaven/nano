import { useState, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useLang } from '../i18n.js';
import AudioPlayer from '../components/AudioPlayer.jsx';

const API = '/api';
const LEVEL_ORDER = ['foundation', 'intermediate', 'advanced'];

// ── Box (media library) ──────────────────────────────────────────────────────

function BoxView({ user, lang }) {
  const { t } = useLang();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cid = user?.channel_id;
    axios.get(`${API}/digital-assets${cid ? `?channel_id=${cid}` : ''}`)
      .then(r => {
        const raw = r.data.assets || [];
        setAssets(raw.map(a => ({
          ...a,
          mediaType: (a.content_type || '').startsWith('audio/') ? 'audio'
                   : (a.content_type || '').startsWith('video/') ? 'video'
                   : 'other',
        })));
      })
      .catch(() => setAssets([]))
      .finally(() => setLoading(false));
  }, [user?.channel_id]);

  if (loading) return <div className="ac-loading"><span /><span /><span /></div>;
  if (assets.length === 0) return <div className="ac-empty">{t.acNoWellness}</div>;

  return (
    <div className="wellness-list">
      {assets.map(a => {
        const title = lang === 'zh' ? (a.title_zh || a.title) : (a.title || a.title_zh);
        if (a.mediaType === 'audio') return <AudioPlayer key={a.id} track={a} lang={lang} />;
        if (a.mediaType === 'video') return (
          <div key={a.id} className="wellness-video-row">
            <div className="audio-player-title">{title}</div>
            <video src={a.url} controls playsInline className="ac-video" />
          </div>
        );
        return (
          <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className="wellness-doc-row">
            {title}
          </a>
        );
      })}
    </div>
  );
}

export default function AcademyTab({ user }) {
  const { t, lang } = useLang();
  const [innerTab, setInnerTab] = useState('academy');

  const [courses, setCourses] = useState([]);
  const [progress, setProgress] = useState({});
  const [dashboard, setDashboard] = useState(null);
  const [paths, setPaths] = useState([]);
  const [certs, setCerts] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lockMsg, setLockMsg] = useState('');

  const [activeCourse, setActiveCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [activeLesson, setActiveLesson] = useState(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [quizSubmitting, setQuizSubmitting] = useState(false);
  const [certDetail, setCertDetail] = useState(null);
  const [libraryItem, setLibraryItem] = useState(null);
  const [libraryContent, setLibraryContent] = useState('');
  const [libraryLoading, setLibraryLoading] = useState(false);

  useEffect(() => {
    if (!user?.user_id) return;
    setLoading(true);
    Promise.allSettled([
      axios.get(`${API}/academy/courses`),
      axios.get(`${API}/academy/progress?user_id=${user.user_id}`),
      axios.get(`${API}/academy/coach-dashboard?user_id=${user.user_id}`),
      axios.get(`${API}/academy/learning-paths`),
      axios.get(`${API}/academy/coach-certifications?user_id=${user.user_id}`),
      axios.get(`${API}/academy/library`),
    ]).then(([cRes, pRes, dRes, pathRes, certRes, libRes]) => {
      const rawCourses = cRes.status === 'fulfilled' ? (cRes.value.data.courses || []) : [];
      const published = rawCourses.filter(c => c.status === 'published');
      const progressRows = pRes.status === 'fulfilled' ? (pRes.value.data.progress || []) : [];
      const map = {};
      const completedByCourse = {};
      for (const p of progressRows) {
        map[p.lesson_id] = p;
        if (p.course_id) completedByCourse[p.course_id] = (completedByCourse[p.course_id] || 0) + 1;
      }
      const completedCourseIds = new Set(
        published.filter(c => c.lesson_count > 0 && (completedByCourse[c.id] || 0) >= c.lesson_count).map(c => c.id)
      );
      const coursesWithLock = published.map(c => ({
        ...c,
        _locked: c.prerequisite_course_id ? !completedCourseIds.has(c.prerequisite_course_id) : false,
      }));
      setCourses(coursesWithLock);
      setProgress(map);
      setDashboard(dRes.status === 'fulfilled' ? dRes.value.data : null);
      const rawPaths = pathRes.status === 'fulfilled' ? (pathRes.value.data.paths || []) : [];
      setPaths(rawPaths.map(p => {
        const pcourses = p.courses || [];
        const done = pcourses.filter(c => completedCourseIds.has(c.course_id)).length;
        return { ...p, _total: pcourses.length, _done: done };
      }));
      setCerts(certRes.status === 'fulfilled' ? (certRes.value.data.certifications || []) : []);
      setLibrary(libRes.status === 'fulfilled' ? (libRes.value.data.items || []) : []);
    }).finally(() => setLoading(false));
  }, [user?.user_id]);

  const openCourse = async (course) => {
    if (course._locked) {
      const prereq = course.prerequisite_title || t.acPrerequisite;
      setLockMsg(t.acCourseLocked(prereq));
      setTimeout(() => setLockMsg(''), 2500);
      return;
    }
    setActiveCourse(course);
    setLessonLoading(true);
    setActiveLesson(null);
    setQuizAnswers({});
    setQuizResult(null);
    try {
      const r = await axios.get(`${API}/academy/lessons?course_id=${course.id}`);
      setLessons(r.data.lessons || []);
    } catch { setLessons([]); }
    setLessonLoading(false);
  };

  const openLesson = async (lesson) => {
    setLessonLoading(true);
    setQuizAnswers({});
    setQuizResult(null);
    try {
      const r = await axios.get(`${API}/academy/lessons/${lesson.id}`);
      setActiveLesson({ ...(r.data.lesson || lesson), quiz_questions: r.data.quiz_questions || [] });
    } catch { setActiveLesson(lesson); }
    setLessonLoading(false);
  };

  const markComplete = async (lessonId) => {
    try {
      await axios.post(`${API}/academy/progress`, { user_id: user.user_id, lesson_id: lessonId });
      setProgress(prev => ({ ...prev, [lessonId]: { lesson_id: lessonId, completed_at: new Date().toISOString() } }));
    } catch {}
  };

  const submitQuiz = async () => {
    const quizzes = activeLesson?.quiz_questions || [];
    if (!quizzes.length) return;
    setQuizSubmitting(true);
    try {
      const r = await axios.post(`${API}/academy/quiz-attempts`, {
        user_id: user.user_id, lesson_id: activeLesson.id, answers: quizAnswers,
      });
      setQuizResult({ score: r.data.score ?? 0, passed: !!r.data.passed });
      if (!progress[activeLesson.id]) await markComplete(activeLesson.id);
    } catch { setQuizResult({ score: 0, passed: false }); }
    setQuizSubmitting(false);
  };

  const openLibraryItem = async (item) => {
    setLibraryItem(item);
    setLibraryLoading(true);
    try {
      const r = await axios.get(`${API}/academy/library/${item.id}`);
      setLibraryContent(r.data.content || '');
    } catch { setLibraryContent(''); }
    setLibraryLoading(false);
  };

  const downloadCert = async (cert) => {
    if (!cert.cert_oss_key) return;
    try {
      const r = await axios.get(`${API}/oss/presign?action=get&key=${encodeURIComponent(cert.cert_oss_key)}`);
      if (r.data.url) window.open(r.data.url, '_blank');
    } catch { /* silent */ }
  };

  const lessonDone = id => !!progress[id];

  // ── Lesson viewer ────────────────────────────────────────────────────────
  if (activeLesson) {
    const quizzes = activeLesson.quiz_questions || [];
    const done = lessonDone(activeLesson.id);
    return (
      <div className="academy-tab">
        <div className="ac-nav-row">
          <button className="ac-back-btn" onClick={() => { setActiveLesson(null); setQuizAnswers({}); setQuizResult(null); }}>
            ← {t.acBack}
          </button>
          {done && <span className="ac-done-badge">{t.acCompleted}</span>}
        </div>
        <div className="ac-lesson-title">{activeLesson.title}</div>
        {activeLesson.content_type === 'video' && activeLesson.video_url && (
          <div className="ac-video-wrap">
            <video src={activeLesson.video_url} controls playsInline className="ac-video" />
          </div>
        )}
        {activeLesson.content && (
          <div className="ac-lesson-body"><ReactMarkdown>{activeLesson.content}</ReactMarkdown></div>
        )}
        {quizzes.length > 0 && (
          <div className="ac-quiz">
            <div className="ac-quiz-title">{t.acQuiz}</div>
            {quizzes.map((q, i) => (
              <div key={q.id} className="ac-quiz-q">
                <div className="ac-quiz-prompt">{i + 1}. {q.question}</div>
                {(q.options || []).map((opt, j) => (
                  <label key={j} className={`ac-quiz-opt${quizAnswers[q.id] === j ? ' selected' : ''}`}>
                    <input type="radio" name={`q${q.id}`} value={j} checked={quizAnswers[q.id] === j}
                      onChange={() => setQuizAnswers(prev => ({ ...prev, [q.id]: j }))} />
                    {opt.text ?? opt}
                  </label>
                ))}
              </div>
            ))}
            {quizResult == null ? (
              <button className="ac-submit-btn" onClick={submitQuiz}
                disabled={quizSubmitting || Object.keys(quizAnswers).length < quizzes.length}>
                {quizSubmitting ? '…' : t.acSubmitQuiz}
              </button>
            ) : (
              <div className={`ac-quiz-result${quizResult.passed ? ' passed' : ' failed'}`}>
                {t.acQuizScore(quizResult.score)} — {quizResult.passed ? t.acQuizPassed : t.acQuizFailed}
              </div>
            )}
          </div>
        )}
        {quizzes.length === 0 && !done && (
          <button className="ac-submit-btn" onClick={() => markComplete(activeLesson.id)}>
            {t.acCompleted} ✓
          </button>
        )}
      </div>
    );
  }

  // ── Lesson list ──────────────────────────────────────────────────────────
  if (activeCourse) {
    return (
      <div className="academy-tab">
        <div className="ac-nav-row">
          <button className="ac-back-btn" onClick={() => setActiveCourse(null)}>← {t.acBack}</button>
        </div>
        <div className="ac-course-header">
          {activeCourse.thumbnail_url && (
            <img src={activeCourse.thumbnail_url} className="ac-course-thumb-lg" alt="" />
          )}
          <div className="ac-course-title-lg">{activeCourse.title}</div>
          {activeCourse.description && <div className="ac-course-desc">{activeCourse.description}</div>}
        </div>
        {lessonLoading ? (
          <div className="ac-loading"><span /><span /><span /></div>
        ) : (
          <div className="ac-lesson-list">
            {lessons.map((lesson, idx) => {
              const done = lessonDone(lesson.id);
              return (
                <button key={lesson.id} className={`ac-lesson-row${done ? ' done' : ''}`} onClick={() => openLesson(lesson)}>
                  <div className="ac-lesson-num">{idx + 1}</div>
                  <div className="ac-lesson-info">
                    <div className="ac-lesson-name">{lesson.title}</div>
                    <div className="ac-lesson-meta">
                      {lesson.content_type === 'video' && <span className="ac-tag ac-tag--video">▶ Video</span>}
                      {lesson.credit_value > 0 && <span className="ac-tag">{t.acCredits(lesson.credit_value)}</span>}
                    </div>
                  </div>
                  {done && <span className="ac-check">✓</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── Library content viewer ───────────────────────────────────────────────
  if (libraryItem) {
    return (
      <div className="academy-tab">
        <div className="ac-nav-row">
          <button className="ac-back-btn" onClick={() => setLibraryItem(null)}>← {t.acBack}</button>
        </div>
        <div className="ac-lesson-title">{libraryItem.title}</div>
        {libraryLoading ? (
          <div className="ac-loading"><span /><span /><span /></div>
        ) : (
          <div className="ac-lesson-body"><ReactMarkdown>{libraryContent}</ReactMarkdown></div>
        )}
      </div>
    );
  }

  return (
    <div className="academy-tab">
      <div className="ac-sub-tabs">
        <button className={`ac-sub-tab${innerTab === 'academy' ? ' active' : ''}`} onClick={() => setInnerTab('academy')}>
          {t.acAcademyInner}
        </button>
        <button className={`ac-sub-tab${innerTab === 'box' ? ' active' : ''}`} onClick={() => setInnerTab('box')}>
          {t.acBoxInner}
        </button>
      </div>

      {innerTab === 'academy' && (
        loading ? (
          <div className="ac-loading"><span /><span /><span /></div>
        ) : (
          <div className="ac-home-scroll">
            {lockMsg && <div className="ac-lock-toast">{lockMsg}</div>}

            {dashboard && (
              <div className="academy-status-card">
                <div className="academy-status-header">
                  <span className="academy-status-label">{t.acStatusLabel}</span>
                  <span className="academy-status-tier">{t.acTierLabels[dashboard.tier] || dashboard.tier}</span>
                </div>
                <div className="academy-status-hero">
                  <span className="academy-status-credits">{dashboard.total_credits}</span>
                  <span className="academy-status-credits-label">{t.acCreditsLabel}</span>
                </div>
                <div className="academy-status-stats">
                  <div className="academy-status-stat">
                    <span className="academy-status-stat-num">{dashboard.completed_lessons}</span>
                    <span className="academy-status-stat-label">{t.acLessonsStatLabel}</span>
                  </div>
                  <div className="academy-status-stat">
                    <span className="academy-status-stat-num">{dashboard.certifications_count}</span>
                    <span className="academy-status-stat-label">{t.acCertsStatLabel}</span>
                  </div>
                </div>
              </div>
            )}

            {paths.length > 0 && (
              <>
                <div className="training-section-title">{t.acPaths}</div>
                <div className="paths-list">
                  {paths.map(p => (
                    <div key={p.id} className="path-card">
                      <div className="path-title">{p.title}</div>
                      {p.description && <div className="path-desc">{p.description}</div>}
                      <div className="path-meta">{t.acPathCourses(p._total)}</div>
                      {p._total > 0 && (
                        <div className="ac-progress-bar">
                          <div className="ac-progress-fill" style={{ width: `${Math.round((p._done / p._total) * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="training-section-title">{t.acCourses}</div>
            {courses.length === 0 ? (
              <div className="ac-empty">{t.acNoCourses}</div>
            ) : (
              <div className="ac-course-list">
                {LEVEL_ORDER.flatMap(level => {
                  const lvlCourses = courses.filter(c => c.level === level);
                  if (!lvlCourses.length) return [];
                  return [
                    <div key={level} className="ac-level-header">{t.acLevel[level]}</div>,
                    ...lvlCourses.map(course => {
                      const totalLessons = course.lesson_count ?? 0;
                      const doneLessons = Object.values(progress).filter(p => p.course_id === course.id).length;
                      const pct = totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;
                      return (
                        <button
                          key={course.id}
                          className={`ac-course-card${course._locked ? ' ac-course-card--locked' : ''}`}
                          onClick={() => openCourse(course)}
                        >
                          {course.thumbnail_url && <img src={course.thumbnail_url} className="ac-course-thumb" alt="" />}
                          <div className="ac-course-body">
                            <div className="ac-course-name">
                              {course.title}
                              {course._locked && <span className="ac-lock-icon">🔒</span>}
                            </div>
                            <div className="ac-course-meta">
                              {totalLessons > 0 && <span>{t.acLessons(totalLessons)}</span>}
                              {course.credit_value > 0 && <span>{t.acCredits(course.credit_value)}</span>}
                            </div>
                            {totalLessons > 0 && (
                              <div className="ac-progress-bar">
                                <div className="ac-progress-fill" style={{ width: `${pct}%` }} />
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    }),
                  ];
                })}
              </div>
            )}

            {certs.length > 0 && (
              <>
                <div className="training-section-title">{t.acMyCerts}</div>
                <div className="ac-certs-list">
                  {certs.map(c => (
                    <button key={c.id} className="ac-cert-card" onClick={() => setCertDetail(c)}>
                      <div className="ac-cert-name">{c.title}</div>
                      <div className="ac-cert-meta">
                        <span>{t.acEarned}: {c.earned_at ? new Date(c.earned_at).toLocaleDateString() : '—'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            <div className="training-section-title">{t.acLibrary}</div>
            {library.length === 0 ? (
              <div className="ac-empty">{t.acNoLibrary}</div>
            ) : (
              <div className="library-list">
                {library.map(item => (
                  <button key={item.id} className="library-row" onClick={() => openLibraryItem(item)}>
                    {item.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      )}

      {innerTab === 'box' && <BoxView user={user} lang={lang} />}

      {certDetail && (
        <div className="modal-overlay" onClick={() => setCertDetail(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <div className="referral-modal-header">
              <span className="modal-title">{certDetail.title}</span>
              <button className="referral-close-btn" onClick={() => setCertDetail(null)} aria-label={t.cancel}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="plan-detail-section">
              <span className="plan-detail-label">{t.acCertName}</span>
              <span className="plan-detail-value">{user.nickname || '—'}</span>
            </div>
            {certDetail.course_display_name && (
              <div className="plan-detail-section">
                <span className="plan-detail-label">{t.acCertCourse}</span>
                <span className="plan-detail-value">{certDetail.course_display_name}</span>
              </div>
            )}
            {certDetail.certificate_number && (
              <div className="plan-detail-section">
                <span className="plan-detail-label">{t.acCertNumber}</span>
                <span className="plan-detail-value">{certDetail.certificate_number}</span>
              </div>
            )}
            {certDetail.issue_date && (
              <div className="plan-detail-section">
                <span className="plan-detail-label">{t.acCertIssued}</span>
                <span className="plan-detail-value">{new Date(certDetail.issue_date).toLocaleDateString()}</span>
              </div>
            )}
            {certDetail.score != null && (
              <div className="plan-detail-section">
                <span className="plan-detail-label">{t.acCertScore}</span>
                <span className="plan-detail-value">{certDetail.score}</span>
              </div>
            )}
            {certDetail.cert_oss_key && (
              <button className="modal-btn modal-btn--primary" onClick={() => downloadCert(certDetail)}>
                ↓ {t.acCertDownload}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
