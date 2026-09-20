// Custom avatar generation: a user's photo → a personal 4-mood avatar set in the gallery's art
// style (docs/architecture/avatar-gallery.md §6). Pure orchestration over injectable clients so
// the pipeline is testable offline; the HTTP handlers live in handlers/avatar_generation.js.
//
// Pipeline (measured live, 2026-09-19/20, temp/avatar-gen-spike.js):
//   1. GATE   qwen-vl-plus over the photo — exactly one real, frontal human face, or reject.
//   2. BASE   photo + the gallery style reference → the 'relaxed' variant (~10 s). The reference
//             is the LAST input image on purpose: the API takes the output aspect from it.
//   3. MOODS  three edits of the BASE (never of the photo) — identity and style are anchored once
//             and only expression + background change, which is the relationship the gallery rows
//             have. Run SEQUENTIALLY: the per-model quota is requests/minute, account-wide
//             (three concurrent calls 429'd live); generateImage backs off on 429.
//   4. STORE  originals to OSS, then 300 px / 160 px JPEG derivatives via OSS image processing.
//   5. FINISH mood_keys + status; the source photo is deleted in a finally — on every outcome.
//
// Cost: 4 image calls per successful attempt, billed per generated image; the gate is a
// qwen-vl-plus call. Wall time ≈ 35–60 s on qwen-image-3.0, inside the worker's 300 s timeout.

const MOODS = ['engaged', 'relaxed', 'restored', 'stressed'];
const DEFAULT_MOOD = 'relaxed';

// qwen-image-3.0: best likeness of the models tried on a real photo (2026-09-20) and 20 req/min.
// qwen-image-2.0-pro looked good in the spike but is capped at 2 req/min ACCOUNT-WIDE
// (help.aliyun.com/zh/model-studio/rate-limit) — a 4-call set alone needs 2 minutes and two users
// generating at once fail with 429. qwen-image-2.0 (2 req/s) renders grainy/textured; edit-plus
// (2 req/s) drifts the face and paints accessories when the prompt names one.
const DEFAULT_MODEL = 'qwen-image-3.0';
const GATE_MODEL = 'qwen-vl-plus';
const GEN_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const OUTPUT_SIZE = '1024*1024';
const STYLE_REF_KEY = 'avatars/style-ref/relaxed.png';   // 512 px gallery PNG, uploaded once
const MAX_SOURCE_BYTES = 6 * 1024 * 1024;                 // the API caps input at 10 MB; base64 inflates it

// OSS image-processing recipes — identical output spec to temp/upload-avatar-gallery.js.
const FULL_PROCESS = 'image/resize,m_fill,w_300,h_300/format,jpg/quality,q_82';
const THUMB_PROCESS = 'image/resize,m_fill,w_160,h_160/format,jpg/quality,q_75';

// ---- prompts -------------------------------------------------------------------------------------

const STYLE_SHEET =
    'Stylized semi-realistic 3D-rendered character portrait (soft smooth shading, natural human proportions, ' +
    'realistic eye size, no exaggerated cartoon features, no cartoon eyes), head-and-shoulders bust, facing the camera, ' +
    'centered, soft even studio lighting, simple solid-color casual crew-neck top, plain, perfectly smooth, untextured ' +
    'vertical gradient background with nothing else, no text, no logo, no watermark, square 1:1 composition.';

const BASE_PROMPT =
    'Redraw the person in image 1 as a character in exactly the art style of image 2. ' + STYLE_SHEET + ' ' +
    'Keep the person from image 1 recognizable: same face shape, hairstyle, hair colour, ' +
    'skin tone, apparent age and gender. The person is Chinese unless the photo clearly shows otherwise — preserve East Asian ' +
    'facial features exactly (eye shape, eyelids, nose bridge, face contour, skin tone); never drift toward Western features. Keep any accessories exactly as in image 1 and add none. ' +
    'Do not copy the face of image 2 — only its rendering style, framing and background treatment. ' +
    'Expression: calm and relaxed with a gentle closed-mouth smile. ' +
    'Replace the background entirely with a plain, perfectly smooth mint-teal vertical gradient (light mint at the bottom to soft teal at the top).';

const MOOD_EDIT_PREFIX =
    'Keep this exact character — same face, same East Asian facial features, same art style, same hairstyle, same clothing, ' +
    'same framing and lighting; do not add or remove anything on the face. Change only two things: ';

const MOOD_PROMPTS = {
    engaged: MOOD_EDIT_PREFIX +
        'the expression becomes a bright, energetic, open-eyed smile full of enthusiasm (a warm smile, mouth at most slightly open); ' +
        'the background becomes a plain warm golden-yellow, perfectly smooth vertical gradient (pale yellow at the bottom to golden at the top). No text.',
    restored: MOOD_EDIT_PREFIX +
        'the expression becomes serene, well-rested and content, a soft gentle smile with relaxed eyes; ' +
        'the background becomes a plain soft lavender-blue, perfectly smooth vertical gradient (pale periwinkle at the bottom to lavender-blue at the top). No text.',
    stressed: MOOD_EDIT_PREFIX +
        'the expression becomes mildly worried and tense — slightly furrowed brows, a subtle frown, no smile, not exaggerated; ' +
        'the background becomes a plain coral-red, perfectly smooth vertical gradient (light salmon at the bottom to coral red at the top). No text.',
};

const NEGATIVE_PROMPT =
    'text, watermark, logo, extra people, hands, hat, distorted face, deformed, blurry, low quality, photo-realistic skin pores';

const GATE_PROMPT =
    'You are checking whether a photo is suitable as the source for a cartoon avatar. Answer with JSON only, no prose: ' +
    '{"face_count": <integer>, "is_photo_of_real_person": <bool>, "is_frontal": <bool>, "face_clearly_visible": <bool>, "notes": "<short>"}. ' +
    'face_count counts distinct human faces. is_photo_of_real_person is false for drawings, screenshots of documents, objects, pets, or already-cartoon images. ' +
    'is_frontal is true when the largest face is roughly facing the camera (within ~30 degrees).';

// ---- helpers -------------------------------------------------------------------------------------

function toDataUrl(buffer, contentType) {
    return `data:${contentType || 'image/jpeg'};base64,${buffer.toString('base64')}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Maps the gate's JSON to a verdict. Anything unparseable is treated as "not a photo" — the
// gate is cheap and a re-upload costs the user nothing, whereas a wrong pass costs 4 image calls.
function evaluateGate(raw) {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    let parsed = null;
    try { parsed = m ? JSON.parse(m[0]) : null; } catch { parsed = null; }
    if (!parsed) return { ok: false, error_code: 'not_a_photo', parsed: null };
    if (parsed.is_photo_of_real_person !== true) return { ok: false, error_code: 'not_a_photo', parsed };
    const n = Number(parsed.face_count);
    if (!(n >= 1)) return { ok: false, error_code: 'no_face', parsed };
    if (n > 1) return { ok: false, error_code: 'multiple_faces', parsed };
    if (parsed.face_clearly_visible === false) return { ok: false, error_code: 'no_face', parsed };
    if (parsed.is_frontal !== true) return { ok: false, error_code: 'not_frontal', parsed };
    return { ok: true, error_code: null, parsed };
}

async function gatePhoto({ llmClient, photoDataUrl }) {
    const completion = await llmClient.chat.completions.create({
        model: GATE_MODEL,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: photoDataUrl } }, { type: 'text', text: GATE_PROMPT }] }],
        temperature: 0,
    });
    return evaluateGate(completion?.choices?.[0]?.message?.content || '');
}

// One synchronous Qwen-Image edit call → PNG Buffer. `images` are data URLs or public URLs, in
// order (the last one sets the output aspect). Retries 429 with backoff (the account quota
// rejects concurrency) and retries the result download once (an ECONNRESET was seen live).
async function generateImage({ http, apiKey, model, images, text, log }) {
    const body = {
        model,
        input: { messages: [{ role: 'user', content: [...images.map((image) => ({ image })), { text }] }] },
        parameters: { n: 1, negative_prompt: NEGATIVE_PROMPT, prompt_extend: false, watermark: false, size: OUTPUT_SIZE },
    };
    let res;
    for (let attempt = 0; ; attempt++) {
        res = await http.post(GEN_URL, body, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            timeout: 120_000,
            maxBodyLength: Infinity,
            validateStatus: () => true,
        });
        if (res.status !== 429 || attempt >= 3) break;
        const wait = 5000 * (attempt + 1);
        log && log('avatar_gen_throttled', { attempt, wait_ms: wait });
        await sleep(wait);
    }
    if (res.status !== 200 || res.data?.code) {
        const err = new Error(`image edit failed: ${res.status} ${res.data?.code || ''} ${res.data?.message || ''}`.trim());
        err.code = 'gen_failed';
        throw err;
    }
    const url = res.data?.output?.choices?.[0]?.message?.content?.find((c) => c && c.image)?.image;
    if (!url) {
        const err = new Error('image edit returned no image');
        err.code = 'gen_failed';
        throw err;
    }
    for (let attempt = 0; ; attempt++) {
        try {
            const img = await http.get(url, { responseType: 'arraybuffer', timeout: 120_000 });
            return Buffer.from(img.data);
        } catch (e) {
            if (attempt >= 1) { const err = new Error(`result download failed: ${e.message}`); err.code = 'gen_failed'; throw err; }
            log && log('avatar_gen_download_retry', { error: e.message });
        }
    }
}

function outputKeys(userId, genId) {
    const base = `avatars/custom/${userId}/${genId}`;
    const keys = {};
    for (const mood of MOODS) keys[mood] = `${base}-${mood}.jpg`;
    keys.thumb = `${base}-thumb.jpg`;
    return keys;
}

// ---- orchestration -------------------------------------------------------------------------------

// Runs one avatar_generations row to a terminal status. Re-entrant: a row already 'done' is left
// alone (EventBridge is at-least-once); a row found 'running' from a killed invocation is redone.
// deps: { pool, ossLib, llmClient, http, apiKey, model?, styleRefKey?, log? }
async function runAvatarGeneration(genId, deps) {
    const { pool, ossLib, llmClient, http, apiKey } = deps;
    const model = deps.model || DEFAULT_MODEL;
    const styleRefKey = deps.styleRefKey || STYLE_REF_KEY;
    const log = deps.log || ((msg, data) => console.log(JSON.stringify({ level: 'INFO', msg, data: { gen_id: genId, ...data } })));

    const { rows } = await pool.query(
        'SELECT id, user_id, status, source_oss_key FROM avatar_generations WHERE id = $1',
        [genId]
    );
    const row = rows[0];
    if (!row) { log('avatar_gen_missing_row', {}); return { ok: false, error_code: 'missing' }; }
    if (row.status === 'done' || row.status === 'rejected' || row.status === 'failed') {
        log('avatar_gen_already_terminal', { status: row.status });
        return { ok: row.status === 'done', error_code: null, status: row.status };
    }
    if (!row.source_oss_key) {
        await pool.query(
            `UPDATE avatar_generations SET status = 'failed', error_code = 'gen_failed', finished_at = NOW() WHERE id = $1`, [genId]
        );
        return { ok: false, error_code: 'gen_failed' };
    }

    const userId = row.user_id;
    const sourceKey = row.source_oss_key;
    await pool.query(`UPDATE avatar_generations SET status = 'running', started_at = NOW() WHERE id = $1`, [genId]);

    const t0 = Date.now();
    const tempKeys = [];
    try {
        // 1. GATE
        const source = await ossLib.getObjectBuffer(sourceKey);
        if (!source || source.length === 0 || source.length > MAX_SOURCE_BYTES) {
            const err = new Error(`source photo unusable (${source ? source.length : 0} bytes)`);
            err.code = 'not_a_photo';
            throw err;
        }
        const head = await ossLib.headObject(sourceKey);
        const photoDataUrl = toDataUrl(source, head?.content_type || 'image/jpeg');
        const gate = await gatePhoto({ llmClient, photoDataUrl });
        log('avatar_gen_gate', { ok: gate.ok, error_code: gate.error_code, parsed: gate.parsed });
        if (!gate.ok) {
            await pool.query(
                `UPDATE avatar_generations SET status = 'rejected', error_code = $2, finished_at = NOW() WHERE id = $1`,
                [genId, gate.error_code]
            );
            return { ok: false, error_code: gate.error_code, status: 'rejected' };
        }

        // 2. BASE (relaxed)
        const styleRef = await ossLib.getObjectBuffer(styleRefKey);
        const styleRefDataUrl = toDataUrl(styleRef, 'image/png');
        const stepLog = (msg, data) => log(msg, data);
        const outputs = {};
        let t = Date.now();
        outputs.relaxed = await generateImage({ http, apiKey, model, images: [photoDataUrl, styleRefDataUrl], text: BASE_PROMPT, log: stepLog });
        log('avatar_gen_step', { step: 'relaxed', ms: Date.now() - t, bytes: outputs.relaxed.length });

        // 3. MOODS — sequential, each an edit of the base
        const baseDataUrl = toDataUrl(outputs.relaxed, 'image/png');
        for (const mood of MOODS) {
            if (mood === DEFAULT_MOOD) continue;
            t = Date.now();
            outputs[mood] = await generateImage({ http, apiKey, model, images: [baseDataUrl], text: MOOD_PROMPTS[mood], log: stepLog });
            log('avatar_gen_step', { step: mood, ms: Date.now() - t, bytes: outputs[mood].length });
        }

        // 4. STORE — original PNG (temporary), then the JPEG derivatives the app actually serves
        const keys = outputKeys(userId, genId);
        try {
            for (const mood of MOODS) {
                const srcKey = `avatars/custom/${userId}/${genId}-${mood}-src.png`;
                tempKeys.push(srcKey);
                await ossLib.putObjectBuffer(srcKey, outputs[mood], 'image/png');
                await ossLib.processObjectSave(srcKey, keys[mood], FULL_PROCESS);
                if (mood === DEFAULT_MOOD) await ossLib.processObjectSave(srcKey, keys.thumb, THUMB_PROCESS);
            }
        } catch (e) {
            const err = new Error(`store failed: ${e.message}`);
            err.code = 'store_failed';
            throw err;
        }

        // 5. FINISH
        await pool.query(
            `UPDATE avatar_generations SET status = 'done', mood_keys = $2, error_code = NULL, finished_at = NOW() WHERE id = $1`,
            [genId, JSON.stringify(keys)]
        );
        log('avatar_gen_done', { total_ms: Date.now() - t0 });
        return { ok: true, error_code: null, status: 'done', mood_keys: keys };
    } catch (err) {
        const code = err.code && err.code !== 'ERR_BAD_REQUEST' ? err.code : 'gen_failed';
        const known = new Set(['no_face', 'multiple_faces', 'not_a_photo', 'not_frontal', 'gen_failed', 'store_failed']);
        const errorCode = known.has(code) ? code : 'gen_failed';
        console.error(JSON.stringify({ level: 'ERROR', msg: 'avatar_gen_failed', data: { gen_id: genId, error_code: errorCode, error: err.message } }));
        await pool.query(
            `UPDATE avatar_generations SET status = 'failed', error_code = $2, finished_at = NOW() WHERE id = $1`,
            [genId, errorCode]
        ).catch(() => {});
        return { ok: false, error_code: errorCode, status: 'failed' };
    } finally {
        // The face photo never outlives the job, whatever happened above. The -src.png originals
        // are only needed for the OSS-side resize and go too.
        for (const k of [sourceKey, ...tempKeys]) {
            try { await ossLib.deleteObject(k); } catch { /* deleteObject already logs */ }
        }
        await pool.query(`UPDATE avatar_generations SET source_oss_key = NULL WHERE id = $1`, [genId]).catch(() => {});
    }
}

module.exports = {
    MOODS, DEFAULT_MOOD, DEFAULT_MODEL, GATE_MODEL, GEN_URL, STYLE_REF_KEY, MAX_SOURCE_BYTES,
    BASE_PROMPT, MOOD_PROMPTS, NEGATIVE_PROMPT, GATE_PROMPT,
    evaluateGate, gatePhoto, generateImage, outputKeys, runAvatarGeneration,
};
