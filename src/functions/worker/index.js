const { pool } = require('../../lib/db');
const { getNowShanghai, calculateAge } = require('../../lib/time-utils');
const { BiomarkerEstimator } = require('../../lib/estimator/BiomarkerEstimator');
const { BioAgeCalculator } = require('../../lib/bioage/BioAgeCalculator');
const { runWorkflow: runFirstReportWorkflow } = require('../../lib/reports/workflow');

/**
 * Nano User Ingestion, Biomarker Estimation, Bio-Age Calculation & First Report Generation
 */
exports.handler = async (request, response, context) => {
    try {
        const body = JSON.parse(request.body.toString());
        const { openid, nickname, gender, birth_date, test_type, test_data, tested_at, ...rest } = body;

        if (!openid) {
            response.setStatusCode(400);
            return response.send(JSON.stringify({ error: 'openid is required' }));
        }

        // 1. Upsert User Profile
        const userQuery = `
            INSERT INTO users (wechat_openid, nickname, gender, birth_date, bio_data)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (wechat_openid) 
            DO UPDATE SET 
                nickname = COALESCE(EXCLUDED.nickname, users.nickname),
                gender = COALESCE(EXCLUDED.gender, users.gender),
                birth_date = COALESCE(EXCLUDED.birth_date, users.birth_date),
                bio_data = users.bio_data || EXCLUDED.bio_data,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id, birth_date, bio_data;
        `;

        const userResult = await pool.query(userQuery, [
            openid, 
            nickname, 
            gender, 
            birth_date, 
            JSON.stringify(rest)
        ]);

        const user = userResult.rows[0];
        const userId = user.id;

        // 2. Handle Biomarkers with Estimation and BioAge Calculation
        if (test_data) {
            const age = calculateAge(user.birth_date);
            
            // Extract existing biometrics from profile for the estimator
            const biometrics = {
                Weight: user.bio_data.weight,
                Height: user.bio_data.height
            };

            // a. Estimation Phase (actual + estimated)
            const estimator = new BiomarkerEstimator(age, test_data, biometrics);
            const estimationReport = estimator.generateReport();
            
            // b. BioAge Calculation Phase
            const bioAgeCalc = new BioAgeCalculator();
            const bioAgeReport = bioAgeCalc.calculateBioAge(age, {
                hsCRP: estimationReport.BiomarkerValues.hsCRP,
                IL6: estimationReport.BiomarkerValues.IL6,
                GA: estimationReport.BiomarkerValues.GA,
                CD38: estimationReport.BiomarkerValues.CD38,
                GDF15: estimationReport.BiomarkerValues.GDF15,
                CystatinC: estimationReport.BiomarkerValues.CystatinC
            });

            // c. Storage Phase
            const finalData = {
                actual: test_data,
                estimated: estimationReport.BiomarkerValues,
                context: estimationReport.ClinicalContext,
                bioage_profile: bioAgeReport
            };

            const biomarkerQuery = `
                INSERT INTO biomarkers (user_id, test_type, data, bio_age, tested_at)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id;
            `;
            
            const bioResult = await pool.query(biomarkerQuery, [
                userId,
                test_type || 'kino_chip',
                JSON.stringify(finalData),
                bioAgeReport.BioAge,
                tested_at || new Date().toISOString()
            ]);
            
            const scanId = bioResult.rows[0].id;
            console.log(`[${getNowShanghai().toISO()}] BioAge: ${bioAgeReport.BioAge} calculated for user ${userId}`);

            // 3. Trigger "First Report" Generation if this is the user's first completed biomarker test
            const checkFirstQuery = `SELECT COUNT(*) FROM biomarkers WHERE user_id = $1`;
            const checkFirstResult = await pool.query(checkFirstQuery, [userId]);
            
            if (parseInt(checkFirstResult.rows[0].count) === 1) {
                console.log(`[${getNowShanghai().toISO()}] Generating First Report for user ${userId}...`);
                
                const reportMarkdown = await runFirstReportWorkflow({
                    user_profile: user,
                    biomarker_results: finalData,
                    bioage_profile: bioAgeReport
                });

                // Store the report in the notifications table for now (or a dedicated reports table)
                const reportInsertQuery = `
                    INSERT INTO notifications (user_id, scan_id, notification_type, content, status)
                    VALUES ($1, $2, 'biological_report', $3, 'pending');
                `;
                
                await pool.query(reportInsertQuery, [userId, scanId, reportMarkdown]);
                console.log(`[${getNowShanghai().toISO()}] First Report generated and stored for user ${userId}`);
            }
        }

        // 4. Handle Interactive Chat Simulation
        if (body.message) {
            console.log(`[${getNowShanghai().toISO()}] Interactive message from ${openid}: ${body.message}`);
            
            // For now, return a placeholder analysis based on the latest data
            const latestBio = await pool.query('SELECT bio_age FROM biomarkers WHERE user_id = $1 ORDER BY tested_at DESC LIMIT 1', [userId]);
            const bioAge = latestBio.rows[0]?.bio_age || 'N/A';

            response.setStatusCode(200);
            return response.send(JSON.stringify({ 
                success: true, 
                reply: `Based on your latest analysis, your BioAge is **${bioAge}**. I am currently monitoring your inflammation levels (ILI).` 
            }));
        }

        console.log(`[${getNowShanghai().toISO()}] User ${openid} profile updated, ID: ${userId}`);

        response.setStatusCode(200);
        response.send(JSON.stringify({ 
            success: true, 
            user_id: userId 
        }));
    } catch (error) {
        console.error('Error handling request:', error);
        response.setStatusCode(500);
        response.send(JSON.stringify({ error: 'Internal Server Error' }));
    }
};
