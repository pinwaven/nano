const { pool } = require('../lib/db');
const ossLib = require('../lib/oss');
const axios = require('axios');

// Certificate image compositing lives in the separate `media` FC function — it
// needs @napi-rs/canvas + pinyin-pro (native binaries + font data), which nearly
// tripled the worker's deploy package size when they lived here directly.
async function _requestCertificateImage({ certification, issuedCert, nickname }) {
    if (!certification?.template_image_oss_key) return null;
    if (!process.env.MEDIA_URL) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'MEDIA_URL not configured, skipping cert image generation' }));
        return null;
    }
    try {
        const res = await axios.post(
            `${process.env.MEDIA_URL}/generate-certificate`,
            { certification, issuedCert, nickname },
            { headers: { Authorization: `Bearer ${process.env.API_BEARER_TOKEN}` }, timeout: 25000 }
        );
        return res.data?.key || null;
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'certificate image request failed', data: { certification_id: certification?.id, issued_id: issuedCert?.id, error: err.message } }));
        return null;
    }
}

// ── Academy handlers ──────────────────────────────────────────────────────────

async function handleGetAcademyCourses() {
    try {
        const result = await pool.query(`
            SELECT c.*,
                   COUNT(DISTINCT l.id)::int AS lesson_count,
                   pc.title AS prerequisite_title
            FROM academy_courses c
            LEFT JOIN academy_lessons l ON l.course_id = c.id
            LEFT JOIN academy_courses pc ON pc.id = c.prerequisite_course_id
            GROUP BY c.id, pc.title
            ORDER BY c.sort_order ASC, c.created_at DESC`);
        return { success: true, courses: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyCourse(body) {
    try {
        const { title, description, oss_key, status, sort_order, credit_value, level, prerequisite_course_id, thumbnail_oss_key } = body;
        if (!title) return { success: false, error: 'Title is required' };
        const result = await pool.query(
            `INSERT INTO academy_courses
               (title, description, oss_key, status, sort_order, credit_value, level, prerequisite_course_id, thumbnail_oss_key)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [title, description || null, oss_key || null, status || 'draft', sort_order || 0,
             credit_value != null ? credit_value : 10, level || 'foundation',
             prerequisite_course_id || null, thumbnail_oss_key || null]
        );
        return { success: true, course: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyCourse(id, body) {
    try {
        const { title, description, oss_key, status, sort_order, credit_value, level, thumbnail_oss_key } = body;
        const prereqId = Object.prototype.hasOwnProperty.call(body, 'prerequisite_course_id')
            ? (body.prerequisite_course_id || null)
            : undefined;
        const result = await pool.query(
            `UPDATE academy_courses SET
                title                   = COALESCE($1, title),
                description             = COALESCE($2, description),
                oss_key                 = COALESCE($3, oss_key),
                status                  = COALESCE($4, status),
                sort_order              = COALESCE($5, sort_order),
                credit_value            = COALESCE($6, credit_value),
                level                   = COALESCE($7, level),
                prerequisite_course_id  = CASE WHEN $8::boolean THEN $9::int ELSE prerequisite_course_id END,
                thumbnail_oss_key       = COALESCE($10, thumbnail_oss_key),
                updated_at              = NOW()
             WHERE id = $11 RETURNING *`,
            [title || null, description || null, oss_key || null, status || null,
             sort_order != null ? sort_order : null,
             credit_value != null ? credit_value : null,
             level || null,
             prereqId !== undefined,
             prereqId,
             thumbnail_oss_key || null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        return { success: true, course: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyCourse(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_courses WHERE id = $1', [id]);
        if (res.rows.length > 0 && res.rows[0].oss_key) {
            await ossLib.deleteObject(res.rows[0].oss_key);
        }
        await pool.query('DELETE FROM academy_courses WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyLibrary() {
    try {
        const result = await pool.query('SELECT * FROM academy_library ORDER BY created_at DESC');
        return { success: true, items: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyLibraryItem(body) {
    try {
        const { title, oss_key, file_size } = body;
        if (!title || !oss_key) return { success: false, error: 'Title and oss_key are required' };
        const result = await pool.query(
            'INSERT INTO academy_library (title, oss_key, file_size) VALUES ($1, $2, $3) RETURNING *',
            [title, oss_key, file_size || null]
        );
        return { success: true, item: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyLibraryItem(id, body) {
    try {
        const { title } = body;
        const result = await pool.query(
            'UPDATE academy_library SET title = COALESCE($1, title) WHERE id = $2 RETURNING *',
            [title || null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        return { success: true, item: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyLibraryItem(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_library WHERE id = $1', [id]);
        if (res.rows.length > 0) {
            await ossLib.deleteObject(res.rows[0].oss_key);
        }
        await pool.query('DELETE FROM academy_library WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Academy Lessons handlers ──────────────────────────────────────────────────

async function handleGetAcademyLessons(courseId) {
    try {
        if (!courseId) return { success: false, error: 'course_id is required' };
        const result = await pool.query(
            `SELECT l.*,
                    (SELECT COUNT(*) FROM academy_lesson_quizzes q WHERE q.lesson_id = l.id)::int > 0 AS has_quiz
             FROM academy_lessons l
             WHERE l.course_id = $1
             ORDER BY l.sort_order ASC, l.created_at ASC`,
            [courseId]
        );
        return { success: true, lessons: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyLesson(body) {
    try {
        const { course_id, title, description, oss_key, sort_order, content_type, text_content, credit_value, min_watch_seconds } = body;
        if (!course_id || !title) return { success: false, error: 'course_id and title are required' };
        const result = await pool.query(
            `INSERT INTO academy_lessons
               (course_id, title, description, oss_key, sort_order, content_type, text_content, credit_value, min_watch_seconds)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [course_id, title, description || null, oss_key || null, sort_order || 0,
             content_type || 'video', text_content || null,
             credit_value != null ? credit_value : 5, min_watch_seconds || null]
        );
        return { success: true, lesson: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyLesson(id, body) {
    try {
        const { title, description, oss_key, sort_order, content_type, text_content, credit_value, min_watch_seconds } = body;
        const result = await pool.query(
            `UPDATE academy_lessons SET
                title             = COALESCE($1, title),
                description       = COALESCE($2, description),
                oss_key           = COALESCE($3, oss_key),
                sort_order        = COALESCE($4, sort_order),
                content_type      = COALESCE($5, content_type),
                text_content      = COALESCE($6, text_content),
                credit_value      = COALESCE($7, credit_value),
                min_watch_seconds = COALESCE($8, min_watch_seconds)
             WHERE id = $9 RETURNING *`,
            [title || null, description || null, oss_key || null,
             sort_order != null ? sort_order : null,
             content_type || null, text_content || null,
             credit_value != null ? credit_value : null,
             min_watch_seconds != null ? min_watch_seconds : null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        return { success: true, lesson: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyLesson(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_lessons WHERE id = $1', [id]);
        if (res.rows.length > 0 && res.rows[0].oss_key) {
            await ossLib.deleteObject(res.rows[0].oss_key);
        }
        await pool.query('DELETE FROM academy_lessons WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Academy Progress handlers ─────────────────────────────────────────────────

async function handleGetAcademyProgress(userId) {
    try {
        if (!userId) return { success: false, error: 'user_id is required' };
        const result = await pool.query(
            `SELECT p.lesson_id, p.completed_at, p.credits_earned, p.quiz_best_score, p.time_spent_seconds,
                    l.course_id
             FROM academy_coach_progress p
             LEFT JOIN academy_lessons l ON l.id = p.lesson_id
             WHERE p.user_id = $1`,
            [userId]
        );
        return { success: true, progress: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyProgress(body) {
    try {
        const { user_id, lesson_id, time_spent_seconds } = body;
        if (!user_id || !lesson_id) return { success: false, error: 'user_id and lesson_id are required' };

        const existing = await pool.query(
            'SELECT id FROM academy_coach_progress WHERE user_id = $1 AND lesson_id = $2',
            [user_id, lesson_id]
        );
        if (existing.rows.length > 0) {
            if (time_spent_seconds != null) {
                await pool.query(
                    'UPDATE academy_coach_progress SET time_spent_seconds = $1 WHERE user_id = $2 AND lesson_id = $3',
                    [time_spent_seconds, user_id, lesson_id]
                );
            }
            return { success: true, already_completed: true, credits_earned: 0 };
        }

        const lessonRes = await pool.query('SELECT credit_value FROM academy_lessons WHERE id = $1', [lesson_id]);
        const lessonCredit = lessonRes.rows.length > 0 ? (lessonRes.rows[0].credit_value || 5) : 5;

        await pool.query(
            `INSERT INTO academy_coach_progress (user_id, lesson_id, credits_earned, time_spent_seconds)
             VALUES ($1, $2, $3, $4)`,
            [user_id, lesson_id, lessonCredit, time_spent_seconds || 0]
        );
        await pool.query(
            `INSERT INTO academy_credit_ledger (user_id, amount, reason, ref_type, ref_id)
             VALUES ($1, $2, 'lesson_complete', 'lesson', $3)`,
            [user_id, lessonCredit, lesson_id]
        );

        await _checkAndAwardCertifications(user_id);

        return { success: true, credits_earned: lessonCredit };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function _checkAndAwardCertifications(userId) {
    try {
        const certs = await pool.query(
            `SELECT id, required_course_ids, min_credits, cert_number_prefix, validity_years,
                    template_image_oss_key, template_layout
             FROM academy_certifications
             WHERE is_active = TRUE
               AND id NOT IN (SELECT certification_id FROM academy_coach_certifications WHERE user_id = $1)`,
            [userId]
        );
        if (certs.rows.length === 0) return;

        const totalCreditsRes = await pool.query(
            'SELECT COALESCE(SUM(amount),0)::int AS total FROM academy_credit_ledger WHERE user_id = $1',
            [userId]
        );
        const totalCredits = totalCreditsRes.rows[0].total;

        const completedRes = await pool.query(
            `SELECT DISTINCT l.course_id FROM academy_coach_progress p
             JOIN academy_lessons l ON l.id = p.lesson_id
             WHERE p.user_id = $1`,
            [userId]
        );
        const completedCourseIds = new Set(completedRes.rows.map(r => r.course_id));

        const userRes = await pool.query('SELECT nickname FROM users WHERE user_id = $1', [userId]);
        const nickname = userRes.rows[0]?.nickname || '';

        for (const cert of certs.rows) {
            const reqIds = cert.required_course_ids || [];
            if (cert.min_credits > 0 && totalCredits < cert.min_credits) continue;
            if (reqIds.length > 0 && !reqIds.every(id => completedCourseIds.has(id))) continue;

            const issueDate = new Date().toISOString().slice(0, 10);
            const expiryDate = cert.validity_years
                ? new Date(new Date().setFullYear(new Date().getFullYear() + cert.validity_years)).toISOString().slice(0, 10)
                : null;

            const insertRes = await pool.query(
                `INSERT INTO academy_coach_certifications (user_id, certification_id, issue_date, expiry_date)
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING *`,
                [userId, cert.id, issueDate, expiryDate]
            );
            const issuedCert = insertRes.rows[0];
            if (issuedCert) {
                issuedCert.certificate_number = `${cert.cert_number_prefix || 'CERT'}${String(issuedCert.id).padStart(6, '0')}`;
                const ossKey = await _requestCertificateImage({ certification: cert, issuedCert, nickname });
                await pool.query(
                    'UPDATE academy_coach_certifications SET certificate_number = $1, cert_oss_key = $2 WHERE id = $3',
                    [issuedCert.certificate_number, ossKey, issuedCert.id]
                );
            }
            await pool.query(
                `INSERT INTO academy_credit_ledger (user_id, amount, reason, ref_type, ref_id)
                 VALUES ($1, 50, 'cert_earned', 'certification', $2)`,
                [userId, cert.id]
            );
        }
    } catch (err) {
        console.log(JSON.stringify({ level: 'WARN', msg: 'cert check failed', error: err.message }));
    }
}

async function handleGetAcademyCourseProgress() {
    try {
        const result = await pool.query(`
            SELECT
                c.id AS course_id,
                c.title,
                COUNT(DISTINCT l.id)::int AS total_lessons,
                COUNT(DISTINCT p.user_id)::int AS coaches_completed,
                COUNT(DISTINCT p.lesson_id)::int AS total_completions
            FROM academy_courses c
            LEFT JOIN academy_lessons l ON l.course_id = c.id
            LEFT JOIN academy_coach_progress p ON p.lesson_id = l.id
            GROUP BY c.id, c.title
            ORDER BY c.sort_order ASC, c.created_at DESC`);
        return { success: true, progress: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Academy Library content proxy ─────────────────────────────────────────────

async function handleGetAcademyLibraryContent(id) {
    try {
        const res = await pool.query('SELECT oss_key FROM academy_library WHERE id = $1', [id]);
        if (res.rows.length === 0) return { success: false, error: 'Not found', statusCode: 404 };
        const buf = await ossLib.getObjectBuffer(res.rows[0].oss_key);
        return { success: true, content: buf.toString('utf8'), _rawText: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ── Academy — new handlers ────────────────────────────────────────────────────

function _getTier(totalCredits) {
    if (totalCredits >= 700) return 'expert';
    if (totalCredits >= 300) return 'advanced';
    if (totalCredits >= 100) return 'intermediate';
    return 'foundation';
}

async function handleGetAcademyLessonById(lessonId) {
    try {
        const lessonRes = await pool.query('SELECT * FROM academy_lessons WHERE id = $1', [lessonId]);
        if (lessonRes.rows.length === 0) return { success: false, error: 'Not found', statusCode: 404 };
        const quizRes = await pool.query(
            'SELECT * FROM academy_lesson_quizzes WHERE lesson_id = $1 ORDER BY sort_order ASC, id ASC',
            [lessonId]
        );
        return { success: true, lesson: lessonRes.rows[0], quiz_questions: quizRes.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostQuizAttempt(body) {
    try {
        const { user_id, lesson_id, answers } = body;
        if (!user_id || !lesson_id || !answers) return { success: false, error: 'user_id, lesson_id, answers are required' };

        const quizRes = await pool.query(
            'SELECT * FROM academy_lesson_quizzes WHERE lesson_id = $1 ORDER BY sort_order ASC, id ASC',
            [lesson_id]
        );
        if (quizRes.rows.length === 0) return { success: false, error: 'No quiz questions for this lesson' };

        let correct = 0;
        const correctAnswers = [];
        for (const q of quizRes.rows) {
            const opts = q.options;
            const correctIdx = opts.findIndex(o => o.is_correct);
            const submitted = answers[String(q.id)];
            const isCorrect = submitted === correctIdx;
            if (isCorrect) correct++;
            correctAnswers.push({ question_id: q.id, correct_index: correctIdx, explanation: opts[correctIdx]?.explanation || null, is_correct: isCorrect });
        }

        const score = Math.round((correct / quizRes.rows.length) * 100);
        const passed = score >= 70;

        const firstPassRes = await pool.query(
            'SELECT id FROM academy_quiz_attempts WHERE user_id = $1 AND lesson_id = $2 AND passed = TRUE',
            [user_id, lesson_id]
        );
        const isFirstPass = firstPassRes.rows.length === 0;

        let creditsEarned = 0;
        if (passed && isFirstPass) {
            creditsEarned = quizRes.rows.reduce((sum, q) => sum + (q.credit_value || 5), 0);
            await pool.query(
                `INSERT INTO academy_credit_ledger (user_id, amount, reason, ref_type, ref_id)
                 VALUES ($1, $2, 'quiz_pass', 'lesson', $3)`,
                [user_id, creditsEarned, lesson_id]
            );
        }

        await pool.query(
            `INSERT INTO academy_quiz_attempts (user_id, lesson_id, answers, score, passed, credits_earned)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [user_id, lesson_id, JSON.stringify(answers), score, passed, creditsEarned]
        );

        await pool.query(
            `UPDATE academy_coach_progress SET quiz_best_score = GREATEST(COALESCE(quiz_best_score, 0), $1)
             WHERE user_id = $2 AND lesson_id = $3`,
            [score, user_id, lesson_id]
        );

        if (passed && isFirstPass) await _checkAndAwardCertifications(user_id);

        return { success: true, score, passed, credits_earned: creditsEarned, correct_answers: correctAnswers };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachCredits(userId) {
    try {
        if (!userId) return { success: false, error: 'user_id is required' };
        const totalRes = await pool.query(
            'SELECT COALESCE(SUM(amount),0)::int AS total FROM academy_credit_ledger WHERE user_id = $1',
            [userId]
        );
        const total = totalRes.rows[0].total;
        const histRes = await pool.query(
            'SELECT * FROM academy_credit_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
            [userId]
        );
        return { success: true, total, tier: _getTier(total), history: histRes.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachDashboard(userId) {
    try {
        if (!userId) return { success: false, error: 'user_id is required' };
        const [creditsRes, lessonsRes, quizzesRes, certsRes] = await Promise.all([
            pool.query('SELECT COALESCE(SUM(amount),0)::int AS total FROM academy_credit_ledger WHERE user_id = $1', [userId]),
            pool.query('SELECT COUNT(*)::int AS cnt FROM academy_coach_progress WHERE user_id = $1', [userId]),
            pool.query('SELECT COUNT(*)::int AS cnt FROM academy_quiz_attempts WHERE user_id = $1 AND passed = TRUE', [userId]),
            pool.query('SELECT COUNT(*)::int AS cnt FROM academy_coach_certifications WHERE user_id = $1', [userId]),
        ]);
        const total = creditsRes.rows[0].total;
        return {
            success: true,
            total_credits: total,
            tier: _getTier(total),
            completed_lessons: lessonsRes.rows[0].cnt,
            passed_quizzes: quizzesRes.rows[0].cnt,
            certifications_count: certsRes.rows[0].cnt,
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyLeaderboard() {
    try {
        const result = await pool.query(`
            SELECT e.user_id,
                   u.name,
                   e.cohort,
                   COALESCE(SUM(l.amount),0)::int AS total_credits,
                   COUNT(DISTINCT p.lesson_id)::int AS completed_lessons
            FROM academy_enrollments e
            LEFT JOIN users u ON u.user_id = e.user_id
            LEFT JOIN academy_credit_ledger l ON l.user_id = e.user_id
            LEFT JOIN academy_coach_progress p ON p.user_id = e.user_id
            WHERE e.status = 'active'
            GROUP BY e.user_id, u.name, e.cohort
            ORDER BY total_credits DESC
            LIMIT 50`);
        return { success: true, leaderboard: result.rows.map(r => ({ ...r, tier: _getTier(r.total_credits) })) };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyEnrollments(adminCtx) {
    try {
        const { requirePermission } = require('../lib/auth');
        const err = requirePermission(adminCtx, 'academy:read');
        if (err) return err;
        const result = await pool.query(`
            SELECT e.id, e.user_id, e.course_id, e.cohort, e.status, e.enrolled_at, e.enrolled_by, e.notes,
                   u.nickname, u.avatar_url,
                   c.title AS course_title,
                   COALESCE(SUM(l.amount),0)::int AS total_credits,
                   COUNT(DISTINCT p.lesson_id)::int AS completed_lessons
            FROM academy_enrollments e
            LEFT JOIN users u ON u.user_id = e.user_id
            LEFT JOIN academy_courses c ON c.id = e.course_id
            LEFT JOIN academy_credit_ledger l ON l.user_id = e.user_id
            LEFT JOIN academy_coach_progress p ON p.user_id = e.user_id
            GROUP BY e.id, e.user_id, e.course_id, e.cohort, e.status, e.enrolled_at, e.enrolled_by, e.notes, u.nickname, u.avatar_url, c.title
            ORDER BY e.enrolled_at DESC`);
        return { success: true, enrollments: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyEnrollment(body, adminCtx) {
    try {
        const { requirePermission } = require('../lib/auth');
        const err = requirePermission(adminCtx, 'academy:write');
        if (err) return err;
        const { user_id, course_id, cohort, notes } = body;
        if (!user_id) return { success: false, error: 'user_id is required', statusCode: 400 };
        if (!course_id) return { success: false, error: 'course_id is required', statusCode: 400 };
        const result = await pool.query(
            `INSERT INTO academy_enrollments (user_id, course_id, cohort, notes, enrolled_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, course_id) DO UPDATE
               SET cohort = EXCLUDED.cohort, status = 'active',
                   notes = COALESCE(EXCLUDED.notes, academy_enrollments.notes),
                   enrolled_by = EXCLUDED.enrolled_by
             RETURNING *`,
            [user_id, course_id, cohort || null, notes || null, adminCtx.userId || null]
        );
        return { success: true, enrollment: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyEnrollment(id, body, adminCtx) {
    try {
        const { requirePermission } = require('../lib/auth');
        const err = requirePermission(adminCtx, 'academy:write');
        if (err) return err;
        const { course_id, cohort, status, notes } = body;
        const result = await pool.query(
            `UPDATE academy_enrollments SET
               course_id = COALESCE($1, course_id),
               cohort = COALESCE($2, cohort),
               status = COALESCE($3, status),
               notes  = COALESCE($4, notes)
             WHERE id = $5 RETURNING *`,
            [course_id || null, cohort || null, status || null, notes !== undefined ? notes : null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found', statusCode: 404 };
        return { success: true, enrollment: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyEnrollment(id, adminCtx) {
    try {
        const { requirePermission } = require('../lib/auth');
        const err = requirePermission(adminCtx, 'academy:write');
        if (err) return err;
        await pool.query('DELETE FROM academy_enrollments WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyCertifications() {
    try {
        const result = await pool.query('SELECT * FROM academy_certifications ORDER BY created_at ASC');
        return { success: true, certifications: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyCertification(body) {
    try {
        const { title, description, required_course_ids, min_credits, tier, badge_image_url,
                cert_number_prefix, issuing_org, school_org, validity_years, course_display_name,
                template_image_oss_key, template_layout, issue_date, validity_date } = body;
        if (!title) return { success: false, error: 'Title is required' };
        const result = await pool.query(
            `INSERT INTO academy_certifications
               (title, description, required_course_ids, min_credits, tier, badge_image_url,
                cert_number_prefix, issuing_org, school_org, validity_years, course_display_name,
                template_image_oss_key, template_layout, issue_date, validity_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
            [title, description || null, required_course_ids || [], min_credits || 0, tier || null, badge_image_url || null,
             cert_number_prefix || '', issuing_org || null, school_org || null,
             validity_years != null ? parseInt(validity_years) : 3,
             course_display_name || null, template_image_oss_key || null,
             JSON.stringify(template_layout || {}),
             issue_date || null, validity_date || null]
        );
        return { success: true, certification: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyCertification(id, body) {
    try {
        const { title, description, required_course_ids, min_credits, tier, badge_image_url, is_active,
                cert_number_prefix, issuing_org, school_org, validity_years, course_display_name,
                template_image_oss_key, template_layout, issue_date, validity_date } = body;
        const result = await pool.query(
            `UPDATE academy_certifications SET
                title                   = COALESCE($1,  title),
                description             = COALESCE($2,  description),
                required_course_ids     = COALESCE($3,  required_course_ids),
                min_credits             = COALESCE($4,  min_credits),
                tier                    = $5,
                badge_image_url         = COALESCE($6,  badge_image_url),
                is_active               = COALESCE($7,  is_active),
                cert_number_prefix      = COALESCE($8,  cert_number_prefix),
                issuing_org             = COALESCE($9,  issuing_org),
                school_org              = COALESCE($10, school_org),
                validity_years          = COALESCE($11, validity_years),
                course_display_name     = COALESCE($12, course_display_name),
                template_image_oss_key  = COALESCE($13, template_image_oss_key),
                template_layout         = COALESCE($14, template_layout),
                issue_date              = COALESCE($16, issue_date),
                validity_date           = COALESCE($17, validity_date)
             WHERE id = $15 RETURNING *`,
            [title || null, description || null,
             required_course_ids || null,
             min_credits != null ? min_credits : null,
             tier || null,
             badge_image_url || null,
             is_active != null ? is_active : null,
             cert_number_prefix != null ? cert_number_prefix : null,
             issuing_org || null, school_org || null,
             validity_years != null ? parseInt(validity_years) : null,
             course_display_name || null, template_image_oss_key || null,
             template_layout != null ? JSON.stringify(template_layout) : null,
             id,
             issue_date || null, validity_date || null]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };

        // Every student under a certification graduates on the same day, so keep
        // their already-issued certificates' dates in lockstep with the template.
        if (issue_date || validity_date) {
            await pool.query(
                `UPDATE academy_coach_certifications SET
                    issue_date  = COALESCE($1, issue_date),
                    expiry_date = COALESCE($2, expiry_date)
                 WHERE certification_id = $3`,
                [issue_date || null, validity_date || null, id]
            );
        }
        return { success: true, certification: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyCertification(id) {
    try {
        await pool.query('DELETE FROM academy_certifications WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetCoachCertifications(userId) {
    try {
        if (!userId) return { success: false, error: 'user_id is required' };
        const result = await pool.query(
            `SELECT cc.id, cc.user_id, cc.certification_id, cc.earned_at,
                    cc.certificate_number, cc.issue_date, cc.expiry_date, cc.score,
                    cc.assessment_period, cc.cert_oss_key, cc.is_revoked, cc.notes,
                    c.title, c.description, c.tier, c.badge_image_url,
                    c.required_course_ids, c.min_credits,
                    c.cert_number_prefix, c.issuing_org, c.school_org,
                    c.validity_years, c.course_display_name, c.template_image_oss_key,
                    c.template_layout
             FROM academy_coach_certifications cc
             JOIN academy_certifications c ON c.id = cc.certification_id
             WHERE cc.user_id = $1
             ORDER BY cc.earned_at DESC`,
            [userId]
        );
        return { success: true, certifications: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetIssuedCertifications(adminCtx) {
    try {
        const { requirePermission } = require('../lib/auth');
        const err = requirePermission(adminCtx, 'academy:read');
        if (err) return err;
        const result = await pool.query(
            `SELECT cc.id, cc.user_id, cc.certification_id, cc.earned_at,
                    cc.certificate_number, cc.issue_date, cc.expiry_date, cc.score,
                    cc.assessment_period, cc.cert_oss_key, cc.is_revoked, cc.notes,
                    c.title AS cert_title, c.tier,
                    c.cert_number_prefix, c.issuing_org, c.school_org, c.validity_years,
                    c.course_display_name, c.template_image_oss_key, c.template_layout,
                    u.nickname, u.avatar_url
             FROM academy_coach_certifications cc
             JOIN academy_certifications c ON c.id = cc.certification_id
             LEFT JOIN users u ON u.user_id = cc.user_id
             ORDER BY cc.earned_at DESC`
        );
        return { success: true, issued: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// Re-renders and re-uploads a coach certification's image after it's been created
// or edited, so the OSS copy always reflects the current certificate_number/dates —
// single source of truth for admin panel, miniapp, and public verification alike.
async function _generateCertImageForIssuedCert(issuedCert) {
    try {
        const [certRes, userRes] = await Promise.all([
            pool.query('SELECT id, template_image_oss_key, template_layout FROM academy_certifications WHERE id = $1', [issuedCert.certification_id]),
            pool.query('SELECT nickname FROM users WHERE user_id = $1', [issuedCert.user_id]),
        ]);
        const certification = certRes.rows[0];
        if (!certification) return null;
        const nickname = userRes.rows[0]?.nickname || '';
        return await _requestCertificateImage({ certification, issuedCert, nickname });
    } catch (err) {
        console.log(JSON.stringify({ level: 'ERROR', msg: 'cert image regen failed', data: { id: issuedCert.id, error: err.message } }));
        return null;
    }
}

async function handlePutCoachCertification(id, body, adminCtx) {
    try {
        const { requirePermission } = require('../lib/auth');
        const err = requirePermission(adminCtx, 'academy:write');
        if (err) return err;
        const { certificate_number, issue_date, expiry_date, score, assessment_period, cert_oss_key, is_revoked, notes } = body;
        const result = await pool.query(
            `UPDATE academy_coach_certifications SET
                certificate_number = COALESCE($1, certificate_number),
                issue_date         = COALESCE($2::date, issue_date),
                expiry_date        = COALESCE($3::date, expiry_date),
                score              = COALESCE($4, score),
                assessment_period  = COALESCE($5, assessment_period),
                cert_oss_key       = COALESCE($6, cert_oss_key),
                is_revoked         = COALESCE($7, is_revoked),
                notes              = COALESCE($8, notes)
             WHERE id = $9 RETURNING *`,
            [certificate_number || null, issue_date || null, expiry_date || null,
             score != null ? score : null,
             assessment_period || null, cert_oss_key || null,
             is_revoked != null ? is_revoked : null,
             notes || null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        let issued = result.rows[0];
        const ossKey = await _generateCertImageForIssuedCert(issued);
        if (ossKey) {
            const updRes = await pool.query('UPDATE academy_coach_certifications SET cert_oss_key = $1 WHERE id = $2 RETURNING *', [ossKey, issued.id]);
            issued = updRes.rows[0];
        }
        return { success: true, issued };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostCoachCertification(body, adminCtx) {
    try {
        const { requirePermission } = require('../lib/auth');
        const err = requirePermission(adminCtx, 'academy:write');
        if (err) return err;
        const { user_id, certification_id, certificate_number, issue_date, expiry_date, score, assessment_period, notes, cert_oss_key } = body;
        if (!user_id || !certification_id) return { success: false, error: 'user_id and certification_id are required', statusCode: 400 };

        // All students under a certification graduate together, so a freshly issued
        // cert defaults to the certification template's shared issue/validity dates.
        const certRes = await pool.query('SELECT issue_date, validity_date FROM academy_certifications WHERE id = $1', [certification_id]);
        const certDefaults = certRes.rows[0] || {};

        const result = await pool.query(
            `INSERT INTO academy_coach_certifications
               (user_id, certification_id, earned_at, is_manual_issue,
                certificate_number, issue_date, expiry_date, score, assessment_period, notes, cert_oss_key)
             VALUES ($1, $2, NOW(), TRUE, $3, $4::date, $5::date, $6, $7, $8, $9)
             RETURNING *`,
            [user_id, certification_id,
             certificate_number || null,
             issue_date || certDefaults.issue_date || new Date().toISOString().slice(0, 10),
             expiry_date || certDefaults.validity_date || null,
             score != null ? score : null,
             assessment_period || null,
             notes || null,
             cert_oss_key || null]
        );
        let issued = result.rows[0];
        const ossKey = await _generateCertImageForIssuedCert(issued);
        if (ossKey) {
            const updRes = await pool.query('UPDATE academy_coach_certifications SET cert_oss_key = $1 WHERE id = $2 RETURNING *', [ossKey, issued.id]);
            issued = updRes.rows[0];
        }
        return { success: true, issued };
    } catch (err) {
        if (err.code === '23505') return { success: false, error: 'This user already holds this certification', statusCode: 409 };
        return { success: false, error: err.message };
    }
}

async function handleVerifyCertificate(certNumber) {
    try {
        if (!certNumber) return { success: false, error: 'Certificate number is required', statusCode: 400 };
        const result = await pool.query(
            `SELECT cc.id, cc.user_id, cc.certification_id, cc.earned_at,
                    cc.certificate_number, cc.issue_date, cc.expiry_date, cc.score,
                    cc.assessment_period, cc.cert_oss_key, cc.is_revoked,
                    c.title, c.tier, c.issuing_org, c.school_org,
                    c.course_display_name, c.template_image_oss_key,
                    u.nickname
             FROM academy_coach_certifications cc
             JOIN academy_certifications c ON c.id = cc.certification_id
             LEFT JOIN users u ON u.user_id = cc.user_id
             WHERE cc.certificate_number = $1`,
            [certNumber]
        );
        if (result.rows.length === 0) return { success: false, error: 'Certificate not found', statusCode: 404 };
        const cert = result.rows[0];
        if (cert.is_revoked) return { success: false, error: 'Certificate has been revoked', statusCode: 410 };
        return { success: true, valid: true, certificate: cert };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyLearningPaths() {
    try {
        const pathsRes = await pool.query(
            'SELECT * FROM academy_learning_paths WHERE is_active = TRUE ORDER BY sort_order ASC, created_at ASC'
        );
        const coursesRes = await pool.query(
            `SELECT lpc.path_id, lpc.course_id, lpc.sort_order, c.title, c.level, c.credit_value
             FROM academy_learning_path_courses lpc
             JOIN academy_courses c ON c.id = lpc.course_id
             ORDER BY lpc.path_id, lpc.sort_order ASC`
        );
        const coursesByPath = {};
        for (const row of coursesRes.rows) {
            if (!coursesByPath[row.path_id]) coursesByPath[row.path_id] = [];
            coursesByPath[row.path_id].push(row);
        }
        const paths = pathsRes.rows.map(p => ({ ...p, courses: coursesByPath[p.id] || [] }));
        return { success: true, paths };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyLearningPath(body) {
    try {
        const { title, description, tier, sort_order, course_ids } = body;
        if (!title) return { success: false, error: 'Title is required' };
        const pathRes = await pool.query(
            'INSERT INTO academy_learning_paths (title, description, tier, sort_order) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, description || null, tier || 'foundation', sort_order || 0]
        );
        const path = pathRes.rows[0];
        if (Array.isArray(course_ids) && course_ids.length > 0) {
            for (let i = 0; i < course_ids.length; i++) {
                await pool.query(
                    'INSERT INTO academy_learning_path_courses (path_id, course_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [path.id, course_ids[i], i]
                );
            }
        }
        return { success: true, path };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyLearningPath(id, body) {
    try {
        const { title, description, tier, sort_order, is_active, course_ids } = body;
        const result = await pool.query(
            `UPDATE academy_learning_paths SET
                title      = COALESCE($1, title),
                description= COALESCE($2, description),
                tier       = COALESCE($3, tier),
                sort_order = COALESCE($4, sort_order),
                is_active  = COALESCE($5, is_active)
             WHERE id = $6 RETURNING *`,
            [title || null, description || null, tier || null,
             sort_order != null ? sort_order : null,
             is_active != null ? is_active : null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        if (Array.isArray(course_ids)) {
            await pool.query('DELETE FROM academy_learning_path_courses WHERE path_id = $1', [id]);
            for (let i = 0; i < course_ids.length; i++) {
                await pool.query(
                    'INSERT INTO academy_learning_path_courses (path_id, course_id, sort_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
                    [id, course_ids[i], i]
                );
            }
        }
        return { success: true, path: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyLearningPath(id) {
    try {
        await pool.query('DELETE FROM academy_learning_paths WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePostAcademyQuizQuestion(body) {
    try {
        const { lesson_id, scenario, question, options, sort_order, credit_value } = body;
        if (!lesson_id || !question || !options) return { success: false, error: 'lesson_id, question, options are required' };
        const result = await pool.query(
            `INSERT INTO academy_lesson_quizzes (lesson_id, scenario, question, options, sort_order, credit_value)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [lesson_id, scenario || null, question, JSON.stringify(options), sort_order || 0, credit_value || 5]
        );
        return { success: true, question: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handlePutAcademyQuizQuestion(id, body) {
    try {
        const { scenario, question, options, sort_order, credit_value } = body;
        const result = await pool.query(
            `UPDATE academy_lesson_quizzes SET
                scenario     = COALESCE($1, scenario),
                question     = COALESCE($2, question),
                options      = COALESCE($3, options),
                sort_order   = COALESCE($4, sort_order),
                credit_value = COALESCE($5, credit_value)
             WHERE id = $6 RETURNING *`,
            [scenario || null, question || null,
             options ? JSON.stringify(options) : null,
             sort_order != null ? sort_order : null,
             credit_value != null ? credit_value : null, id]
        );
        if (result.rows.length === 0) return { success: false, error: 'Not found' };
        return { success: true, question: result.rows[0] };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleDeleteAcademyQuizQuestion(id) {
    try {
        await pool.query('DELETE FROM academy_lesson_quizzes WHERE id = $1', [id]);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyTemplateImage(id) {
    try {
        const res = await pool.query('SELECT template_image_oss_key FROM academy_certifications WHERE id = $1', [id]);
        if (res.rows.length === 0 || !res.rows[0].template_image_oss_key) {
            return { success: false, error: 'Not found', statusCode: 404 };
        }
        const key = res.rows[0].template_image_oss_key;
        const buf = await ossLib.getObjectBuffer(key);
        const ext = key.split('.').pop().toLowerCase();
        const contentType = ext === 'png' ? 'image/png' : (ext === 'webp' ? 'image/webp' : 'image/jpeg');
        return { success: true, _rawBinary: true, contentType, content: buf.toString('base64') };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function handleGetAcademyCourseProgressAll() {
    try {
        const result = await pool.query(`
            SELECT
                c.id AS course_id,
                c.title,
                c.level,
                c.credit_value AS course_credit_value,
                COUNT(DISTINCT l.id)::int AS total_lessons,
                COUNT(DISTINCT p.coach_user_id)::int AS coaches_started,
                SUM(p.credits_earned)::int AS total_credits_awarded,
                AVG(p.quiz_best_score)::numeric(5,1) AS avg_quiz_score
            FROM academy_courses c
            LEFT JOIN academy_lessons l ON l.course_id = c.id
            LEFT JOIN academy_coach_progress p ON p.lesson_id = l.id
            GROUP BY c.id, c.title, c.level, c.credit_value
            ORDER BY c.sort_order ASC, c.created_at DESC`);
        return { success: true, progress: result.rows };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

module.exports = {
    handleGetAcademyCourses,
    handlePostAcademyCourse,
    handlePutAcademyCourse,
    handleDeleteAcademyCourse,
    handleGetAcademyLibrary,
    handlePostAcademyLibraryItem,
    handlePutAcademyLibraryItem,
    handleDeleteAcademyLibraryItem,
    handleGetAcademyLessons,
    handlePostAcademyLesson,
    handlePutAcademyLesson,
    handleDeleteAcademyLesson,
    handleGetAcademyProgress,
    handlePostAcademyProgress,
    handleGetAcademyCourseProgress,
    handleGetAcademyLibraryContent,
    handleGetAcademyLessonById,
    handlePostQuizAttempt,
    handleGetCoachCredits,
    handleGetCoachDashboard,
    handleGetAcademyLeaderboard,
    handleGetAcademyEnrollments,
    handlePostAcademyEnrollment,
    handlePutAcademyEnrollment,
    handleDeleteAcademyEnrollment,
    handleGetAcademyCertifications,
    handlePostAcademyCertification,
    handlePutAcademyCertification,
    handleDeleteAcademyCertification,
    handleGetCoachCertifications,
    handleGetAcademyTemplateImage,
    handleGetIssuedCertifications,
    handlePostCoachCertification,
    handlePutCoachCertification,
    handleVerifyCertificate,
    handleGetAcademyLearningPaths,
    handlePostAcademyLearningPath,
    handlePutAcademyLearningPath,
    handleDeleteAcademyLearningPath,
    handlePostAcademyQuizQuestion,
    handlePutAcademyQuizQuestion,
    handleDeleteAcademyQuizQuestion,
    handleGetAcademyCourseProgressAll,
};
