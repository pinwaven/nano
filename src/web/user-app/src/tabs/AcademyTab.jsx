import { useState, useEffect } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { useLang } from '../i18n.js';

const API = '/api';
const LEVEL_ORDER = ['foundation', 'intermediate', 'advanced'];

export default function AcademyTab({ user }) {
  const { t } = useLang();
  const [subTab, setSubTab] = useState('courses');
  const [courses, setCourses] = useState([]);
  const [progress, setProgress] = useState({});
  const [certs, setCerts] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCourse, setActiveCourse] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [activeLesson, setActiveLesson] = useState(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [quizSubmitting, setQuizSubmitting] = useState(false);

  useEffect(() => {
    if (!user?.user_id) return;
    setLoading(true);
    Promise.all([
      axios.get(`${API}/academy/courses`),
      axios.get(`${API}/academy/progress?user_id=${user.user_id}`),
    ]).then(([cRes, pRes]) => {
      setCourses(cRes.data.courses || []);
      const map = {};
      for (const p of (pRes.data.progress || [])) map[p.lesson_id] = p;
      setProgress(map);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user?.user_id]);

  useEffect(() => {
    if (subTab === 'certs' && certs.length === 0 && user?.user_id) {
      axios.get(`${API}/academy/coach-certifications?user_id=${user.user_id}`)
        .then(r => setCerts(r.data.certifications || [])).catch(() => {});
    }
    if (subTab === 'leaderboard' && leaderboard.length === 0) {
      axios.get(`${API}/academy/leaderboard`)
        .then(r => setLeaderboard(r.data.leaderboard || [])).catch(() => {});
    }
  }, [subTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCourse = async (course) => {
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
      setActiveLesson(r.data.lesson || lesson);
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
    if (!activeLesson?.quizzes?.length) return;
    setQuizSubmitting(true);
    try {
      const answers = activeLesson.quizzes.map((q, i) => ({ question_id: q.id, answer: quizAnswers[i] ?? '' }));
      const r = await axios.post(`${API}/academy/quiz-attempts`, {
        user_id: user.user_id, lesson_id: activeLesson.id, answers,
      });
      setQuizResult(r.data.correct_count ?? 0);
      if (!progress[activeLesson.id]) await markComplete(activeLesson.id);
    } catch { setQuizResult(0); }
    setQuizSubmitting(false);
  };

  const lessonDone = id => !!progress[id];

  // Lesson viewer
  if (activeLesson) {
    const quizzes = activeLesson.quizzes || [];
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
                  <label key={j} className={`ac-quiz-opt${quizAnswers[i] === opt ? ' selected' : ''}`}>
                    <input type="radio" name={`q${i}`} value={opt} checked={quizAnswers[i] === opt}
                      onChange={() => setQuizAnswers(prev => ({ ...prev, [i]: opt }))} />
                    {opt}
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
              <div className="ac-quiz-result">{t.acCorrect(quizResult)} / {quizzes.length}</div>
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

  // Lesson list
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

  const subTabs = [
    { key: 'courses', label: t.acCourses },
    { key: 'certs',   label: t.acMyCerts },
    { key: 'leaderboard', label: t.acLeaderboard },
  ];

  return (
    <div className="academy-tab">
      <div className="ac-sub-tabs">
        {subTabs.map(s => (
          <button key={s.key} className={`ac-sub-tab${subTab === s.key ? ' active' : ''}`} onClick={() => setSubTab(s.key)}>
            {s.label}
          </button>
        ))}
      </div>

      {subTab === 'courses' && (
        <div className="ac-course-list">
          {loading ? (
            <div className="ac-loading"><span /><span /><span /></div>
          ) : courses.length === 0 ? (
            <div className="ac-empty">{t.acNoCourses}</div>
          ) : (
            LEVEL_ORDER.flatMap(level => {
              const lvlCourses = courses.filter(c => c.level === level && c.status === 'published');
              if (!lvlCourses.length) return [];
              return [
                <div key={level} className="ac-level-header">{t.acLevel[level]}</div>,
                ...lvlCourses.map(course => {
                  const totalLessons = course.lesson_count ?? 0;
                  const doneLessons = Object.values(progress).filter(p => p.course_id === course.id).length;
                  const pct = totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;
                  return (
                    <button key={course.id} className="ac-course-card" onClick={() => openCourse(course)}>
                      {course.thumbnail_url && <img src={course.thumbnail_url} className="ac-course-thumb" alt="" />}
                      <div className="ac-course-body">
                        <div className="ac-course-name">{course.title}</div>
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
            })
          )}
        </div>
      )}

      {subTab === 'certs' && (
        <div className="ac-certs-list">
          {certs.length === 0 ? <div className="ac-empty">{t.acNoCerts}</div> : (
            certs.map(c => (
              <div key={c.id} className="ac-cert-card">
                <div className="ac-cert-name">{c.certification_name || c.title}</div>
                <div className="ac-cert-meta">
                  <span>{t.acEarned}: {c.issued_at ? new Date(c.issued_at).toLocaleDateString() : '—'}</span>
                  {c.certificate_number && (
                    <a href={`/api/academy/verify/${c.certificate_number}`} target="_blank" rel="noopener noreferrer" className="ac-verify-link">
                      {t.acVerify} ↗
                    </a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {subTab === 'leaderboard' && (
        <div className="ac-leaderboard">
          {leaderboard.length === 0 ? <div className="ac-empty">{t.acNoLeaderboard}</div> : (
            <div className="ac-lb-list">
              {leaderboard.map((row, idx) => (
                <div key={row.user_id || idx} className={`ac-lb-row${row.user_id === user.user_id ? ' mine' : ''}`}>
                  <span className="ac-lb-rank">#{idx + 1}</span>
                  <span className="ac-lb-name">{row.nickname || row.coach_name || t.acCoach}</span>
                  <span className="ac-lb-score">{row.total_credits ?? row.credits ?? 0}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
