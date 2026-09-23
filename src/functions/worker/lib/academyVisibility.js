const { pool } = require('./db');
const { requirePermission } = require('./auth');

function scope(ctx) {
    if (ctx?.role === 'user') return [ctx.user.channel_id, ctx.user.user_id];
    if (ctx?.role === 'channel') return [ctx.channelId, null];
    return [null, null];
}
async function settings(ctx, body) {
    const denied = requirePermission(ctx, body ? 'academy:write' : 'academy:read');
    if (denied) return denied;
    if (ctx?.role !== 'channel') return { success: true, settings: null };
    try {
        if (body) {
            if (typeof body.inherit_courses !== 'boolean') return { success: false, statusCode: 400, error: 'inherit_courses must be boolean' };
            await pool.query(`UPDATE channels SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('academy_inherit_courses', $1::boolean) WHERE id = $2`, [body.inherit_courses, ctx.channelId]);
        }
        const { rows } = await pool.query(`SELECT COALESCE(config->>'academy_inherit_courses', 'true') <> 'false' AS inherit_courses FROM channels WHERE id = $1`, [ctx.channelId]);
        return { success: true, settings: rows[0] || null };
    } catch (err) { return { success: false, statusCode: 500, error: err.message }; }
}
async function filterCourses(courses, ctx) {
    const [channel, learner] = scope(ctx);
    if (!channel) return courses;
    const { rows } = await pool.query('SELECT id FROM academy_courses WHERE academy_course_visible(id, $1, $2)', [channel, learner]);
    const ids = new Set(rows.map(r => String(r.id)));
    return courses.filter(c => ids.has(String(c.id)));
}
module.exports = { scope, settings, filterCourses };

// Direct URLs and progress/quiz writes must obey the same catalog decision.
async function authorize(ctx, method, path, query, body) {
    const [channel, learner] = scope(ctx);
    if (!channel) return null;
    let course = query.course_id || body.course_id;
    let lesson = path.match(/^\/academy\/lessons\/(\d+)$/)?.[1] || body.lesson_id;
    const coursePath = path.match(/^\/academy\/courses\/(\d+)$/);
    if (coursePath) course = coursePath[1];
    if (!path.startsWith('/academy/') && path !== '/oss/presign') return null;
    try {
        let courses = [];
        if (lesson) courses = (await pool.query('SELECT course_id AS id FROM academy_lessons WHERE id = $1', [lesson])).rows;
        else if (course) courses = [{ id: course }];
        else if (path === '/oss/presign' && query.key) courses = (await pool.query('SELECT id FROM academy_courses WHERE oss_key = $1 UNION SELECT course_id AS id FROM academy_lessons WHERE oss_key = $1', [query.key])).rows;
        if (!courses.length) return null;
        const visible = await filterCourses(courses, ctx);
        if (visible.length !== courses.length) return { success: false, statusCode: 403, error: 'Course is not available in this channel' };
        // A channel admin may create its own courses, but cannot edit inherited material.
        if (ctx.role === 'channel' && method !== 'GET' && (coursePath || path.startsWith('/academy/lessons'))) {
            const owned = await pool.query('SELECT id FROM academy_courses WHERE id = ANY($1::int[]) AND channel_id = $2', [courses.map(c => c.id), channel]);
            if (owned.rows.length !== courses.length) return { success: false, statusCode: 403, error: 'Only the owning channel can edit this course' };
        }
        return null;
    } catch (err) { return { success: false, statusCode: 500, error: err.message }; }
}
module.exports.authorize = authorize;
