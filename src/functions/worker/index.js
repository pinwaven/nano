const { pool } = require('./lib/db');
const { getNowShanghai, calculateAge } = require('./lib/time-utils');
const { BiomarkerEstimator } = require('./lib/estimator/BiomarkerEstimator');
const { BioAgeCalculator } = require('./lib/bioage/BioAgeCalculator');
const { runWorkflow: runFirstReportWorkflow } = require('./lib/reports/workflow');
const OpenAI = require('openai');
const systemChatTemplate = require('./prompts/systemChat');
const systemNutritionTemplate = require('./prompts/systemNutrition');
const strings = require('./prompts/strings');

// Initialize OpenAI client for DashScope
const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

/**
 * Nano Worker Handler
 */
exports.handler = async (request, response, context) => {
    const isHttp = response && typeof response.send === 'function';
    console.log('[Worker] Handler started. Request type:', isHttp ? 'HTTP' : 'Event');

    try {
        let body;
        
        if (isHttp) {
            // Standard HTTP Trigger
            if (!request.body) {
                body = {};
            } else if (Buffer.isBuffer(request.body)) {
                body = JSON.parse(request.body.toString());
            } else if (typeof request.body === 'string') {
                body = JSON.parse(request.body);
            } else {
                body = request.body;
            }
        } else {
            // request is actually the 'event' object in Event triggers
            const event = request;
            console.log('[Worker] Handling Event:', JSON.stringify(event));
            
            if (Buffer.isBuffer(event)) {
                body = JSON.parse(event.toString());
            } else if (event.data && (Buffer.isBuffer(event.data) || typeof event.data === 'string')) {
                // EventBridge format
                body = typeof event.data === 'string' ? JSON.parse(event.data) : JSON.parse(event.data.toString());
            } else if (typeof event === 'object') {
                // Direct invocation with JSON object
                body = event;
            } else {
                body = JSON.parse(event.toString());
            }
        }

        const { openid, nickname, gender, birth_date, language, test_type, test_data, tested_at, message, ...rest } = body;

            if (!openid) {
                console.error('[Worker] Missing openid in body:', JSON.stringify(body));
                if (isHttp) {
                    response.statusCode = 400;
                    response.setHeader('Content-Type', 'application/json');
                    return response.send(JSON.stringify({ error: 'openid is required' }));
                }
                throw new Error('openid is required');
            }

            // 1. Upsert User Profile
            const userQuery = `
                INSERT INTO users (wechat_openid, nickname, gender, birth_date, language, bio_data)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (wechat_openid) 
                DO UPDATE SET 
                    nickname = COALESCE(EXCLUDED.nickname, users.nickname),
                    gender = COALESCE(EXCLUDED.gender, users.gender),
                    birth_date = COALESCE(EXCLUDED.birth_date, users.birth_date),
                    language = COALESCE(EXCLUDED.language, users.language),
                    bio_data = users.bio_data || EXCLUDED.bio_data,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id, birth_date, bio_data, nickname, language;
            `;

            const userResult = await pool.query(userQuery, [
                openid, 
                nickname, 
                gender, 
                birth_date, 
                language || 'zh', 
                JSON.stringify(rest)
            ]);

            const user = userResult.rows[0];
            const userId = user.id;

            // 2. Handle Biomarkers with Estimation and BioAge Calculation
            let latestBioEntry = null;
            if (test_data) {
                const age = calculateAge(user.birth_date);
                const biometrics = {
                    Weight: user.bio_data.weight,
                    Height: user.bio_data.height
                };

                const estimator = new BiomarkerEstimator(age, test_data, biometrics);
                const estimationReport = estimator.generateReport();
                
                const bioAgeCalc = new BioAgeCalculator();
                const bioAgeReport = bioAgeCalc.calculateBioAge(age, {
                    hsCRP: estimationReport.BiomarkerValues.hsCRP,
                    IL6: estimationReport.BiomarkerValues.IL6,
                    GA: estimationReport.BiomarkerValues.GA,
                    CD38: estimationReport.BiomarkerValues.CD38,
                    GDF15: estimationReport.BiomarkerValues.GDF15,
                    CystatinC: estimationReport.BiomarkerValues.CystatinC
                });

                const finalData = {
                    actual: test_data,
                    estimated: estimationReport.BiomarkerValues,
                    context: estimationReport.ClinicalContext,
                    bioage_profile: bioAgeReport
                };

                const biomarkerQuery = `
                    INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id, data, bio_age;
                `;
                
                const bioResult = await pool.query(biomarkerQuery, [
                    userId,
                    test_type || 'kino_chip',
                    JSON.stringify(finalData),
                    bioAgeReport.BioAge,
                    tested_at || new Date().toISOString()
                ]);
                
                latestBioEntry = bioResult.rows[0];
                const scanId = latestBioEntry.id;
                console.log(`[${getNowShanghai().toISO()}] BioAge: ${bioAgeReport.BioAge} calculated for user ${userId}`);

                // 3. Generate Reports & Plans
                if (process.env.DASHSCOPE_API_KEY) {
                    // a. Check if First Report is needed
                    const checkReportQuery = `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND notification_type = 'biological_report'`;
                    const checkReportResult = await pool.query(checkReportQuery, [userId]);
                    
                    if (parseInt(checkReportResult.rows[0].count) === 0) {
                        console.log(`[${getNowShanghai().toISO()}] Generating First Report for user ${userId}...`);
                        const reportMarkdown = await runFirstReportWorkflow({
                            user_profile: { nickname: user.nickname, gender: user.gender, age: age, language: user.language },
                            biomarker_results: finalData,
                            bioage_profile: bioAgeReport
                        });
                        await pool.query(
                            'INSERT INTO notifications (user_id, biomarker_id, notification_type, content, status) VALUES ($1, $2, $3, $4, $5)',
                            [userId, scanId, 'biological_report', reportMarkdown, 'pending']
                        );
                    }

                    // b. Generate immediate 7-day Nutrition Plan update
                    console.log(`[${getNowShanghai().toISO()}] (MOCKED) Generating 7-day nutrition plan for user ${userId}...`);
                    /*
                    const nutritionContext = {
                        days_needed: body.days_needed || 7,
                        start_date: body.start_from || new Date().toISOString().split('T')[0],
                        biomarkers: finalData,
                        language: user.language
                    };
                    const llm = getLlmClient();
                    const nutritionCompletion = await llm.chat.completions.create({
                        model: process.env.MODEL || 'qwen-turbo',
                        messages: [
                            { role: 'system', content: systemNutritionTemplate(nutritionContext) },
                            { role: 'user', content: 'Generate my precision dots recipe.' }
                        ],
                    });
                    const recipeMarkdown = nutritionCompletion.choices[0].message.content;
                    */
                    const recipeMarkdown = "Mocked Nutrition Plan";
                    await pool.query(
                        'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                        [userId, 'nutrition_plan', recipeMarkdown, 'pending']
                    );
                    console.log(`[${getNowShanghai().toISO()}] Nutrition plan delivered.`);
                }
            }

            // 4. Handle Interactive Chat Replies
            if (message || body.trigger_type === 'nutrition_topup') {
                const isTopUp = body.trigger_type === 'nutrition_topup';
                console.log(`[${getNowShanghai().toISO()}] ${isTopUp ? 'Nutrition Top-up' : 'Chat message'} for ${openid}`);
                
                if (!latestBioEntry) {
                    const latestBio = await pool.query('SELECT data, bio_age FROM biomarkers WHERE user_id = $1 ORDER BY tested_at DESC LIMIT 1', [userId]);
                    latestBioEntry = latestBio.rows[0];
                }

                if (isTopUp) {
                    // Generate the top-up nutrition plan
                    console.log(`[${getNowShanghai().toISO()}] (MOCKED) Generating top-up plan (${body.days_needed} days) for user ${userId}...`);
                    /*
                    const nutritionContext = {
                        days_needed: body.days_needed,
                        start_date: body.start_from,
                        biomarkers: latestBioEntry?.data || {},
                        language: user.language
                    };
                    const llm = getLlmClient();
                    const nutritionCompletion = await llm.chat.completions.create({
                        model: process.env.MODEL || 'qwen-turbo',
                        messages: [
                            { role: 'system', content: systemNutritionTemplate(nutritionContext) },
                            { role: 'user', content: 'Top up my nutrition plan.' }
                        ],
                    });
                    const recipeMarkdown = nutritionCompletion.choices[0].message.content;
                    */
                    const recipeMarkdown = "Mocked Top-up Plan";
                    await pool.query(
                        'INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)',
                        [userId, 'nutrition_plan', recipeMarkdown, 'pending']
                    );
                } else if (message) {
                    const chatContext = {
                        user_profile: user,
                        latest_biomarkers: latestBioEntry?.data || {},
                        bioage_profile: latestBioEntry?.data?.bioage_profile || {},
                        message: message
                    };

                    // If message is 'biomarkers', we already sent the plan/report above, so we can just confirm
                    if (message === 'biomarkers' && latestBioEntry) {
                        const lang = user.language === 'zh' ? 'zh' : 'en';
                        const reply = strings.analysis_complete[lang](latestBioEntry.bio_age);
                        
                        await pool.query('INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)', [userId, 'chat_reply', reply, 'pending']);
                    } else if (process.env.DASHSCOPE_API_KEY) {
                        try {
                            const llm = getLlmClient();
                            const completion = await llm.chat.completions.create({
                                model: process.env.MODEL || 'qwen-turbo',
                                messages: [
                                    { role: 'system', content: systemChatTemplate(chatContext) },
                                    { role: 'user', content: message }
                                ],
                            });
                            const reply = completion.choices[0].message.content;
                            await pool.query('INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)', [userId, 'chat_reply', reply, 'pending']);
                        } catch (llmErr) {
                            console.error('LLM Error:', llmErr.message);
                            const lang = user.language === 'zh' ? 'zh' : 'en';
                            const reply = strings.llm_error_fallback[lang](latestBioEntry?.bio_age || 'N/A');
                            await pool.query('INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)', [userId, 'chat_reply', reply, 'pending']);
                        }
                    } else {
                        const lang = user.language === 'zh' ? 'zh' : 'en';
                        const reply = strings.processing_data[lang];
                        await pool.query('INSERT INTO notifications (user_id, notification_type, content, status) VALUES ($1, $2, $3, $4)', [userId, 'chat_reply', reply, 'pending']);
                    }
                }
            }

        console.log(`[${getNowShanghai().toISO()}] Request handled for user ${openid}`);
        
        if (isHttp) {
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/json');
            return response.send(JSON.stringify({ success: true, user_id: userId }));
        }
        return { success: true, user_id: userId };
    } catch (error) {
        console.error('Error handling request:', error);
        if (isHttp) {
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json');
            return response.send(JSON.stringify({ error: error.message }));
        }
        throw error;
    }
};
