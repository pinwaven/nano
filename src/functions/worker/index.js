const { pool } = require('./lib/db');
const { recordOrderCommissions, recordUserReferralCommission } = require('./lib/commissions');
const { getUserBalance, getLedgerHistory, creditUser, debitUser, getChannelExchangeRate, getChannelCurrency } = require('./lib/credits');
const { recordReferralCommission, generatePartnerPayouts, getPartnerProductDiscount, applyPartnerDiscount, getCommissionRules, resolveRate } = require('./lib/partnerCommissions');
const ossLib = require('./lib/oss');
const {
    generateUserId, generateReferralCode,
    signChannelAdminToken, verifyChannelAdminToken,
    CHANNEL_ADMIN_FULL_PERMS, LEGACY_TAB_EXPANSION,
    expandPermissions, requirePermission, requireAdminTab,
    getWxAccessToken,
} = require('./lib/auth');
const { getNowShanghai, calculateAge } = require('./lib/time-utils');
const { updateHealthTwin } = require('./lib/healthTwinUpdater');
const { BiomarkerEstimator } = require('./lib/estimator/BiomarkerEstimator');
const { deriveTags } = require('./lib/estimator/tagDerivation');
const { BioAgeCalculator } = require('./lib/bioage/BioAgeCalculator');
const { runWorkflow: runFirstReportWorkflow } = require('./lib/reports/workflow');
const OpenAI = require('openai');
const intentClassifierTemplate = require('./prompts/chat/intentClassifier');
const nanoPrompts = {
    casual_chat:        require('./prompts/nano/chat/casual'),
    biomarker_question: require('./prompts/nano/chat/biomarker'),
    nutrition_question: require('./prompts/nano/chat/nutrition'),
    longevity_science:  require('./prompts/nano/chat/science'),
    record_action:      require('./prompts/nano/chat/record'),
    set_reminder:       require('./prompts/nano/chat/reminder'),
    emotional_support:  require('./prompts/nano/chat/emotional'),
};
const vivaPrompts = {
    casual_chat:        require('./prompts/viva/chat/casual'),
    biomarker_question: require('./prompts/viva/chat/biomarker'),
    nutrition_question: require('./prompts/viva/chat/nutrition'),
    longevity_science:  require('./prompts/viva/chat/science'),
    record_action:      require('./prompts/viva/chat/record'),
    set_reminder:       require('./prompts/viva/chat/reminder'),
    emotional_support:  require('./prompts/viva/chat/emotional'),
};
const systemNutritionTemplate = require('./prompts/nano/systemNutrition');
const vivaSystemNutritionTemplate = require('./prompts/viva/systemNutrition');
const systemHealthAdviceTemplate = require('./prompts/nano/systemHealthAdvice');
const strings = require('./prompts/strings');
const systemAdminReportTemplate = require('./prompts/systemAdminReport');
const systemHealthReportTemplate = require('./prompts/nano/systemHealthReport');

const getLlmClient = () => new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

const { handleGetAcademyCourses, handlePostAcademyCourse, handlePutAcademyCourse, handleDeleteAcademyCourse, handleGetAcademyLibrary, handlePostAcademyLibraryItem, handlePutAcademyLibraryItem, handleDeleteAcademyLibraryItem, handleGetAcademyLessons, handlePostAcademyLesson, handlePutAcademyLesson, handleDeleteAcademyLesson, handleGetAcademyProgress, handlePostAcademyProgress, handleGetAcademyCourseProgress, handleGetAcademyLibraryContent, handleGetAcademyLessonById, handlePostQuizAttempt, handleGetCoachCredits, handleGetCoachDashboard, handleGetAcademyLeaderboard, handleGetAcademyCertifications, handlePostAcademyCertification, handlePutAcademyCertification, handleDeleteAcademyCertification, handleGetCoachCertifications, handleGetAcademyTemplateImage, handleGetIssuedCertifications, handlePostCoachCertification, handlePutCoachCertification, handleVerifyCertificate, handleVerifyCertificatesByGovernmentId, handleGetCertImageUrl, handleGetAcademyLearningPaths, handlePostAcademyLearningPath, handlePutAcademyLearningPath, handleDeleteAcademyLearningPath, handlePostAcademyQuizQuestion, handlePutAcademyQuizQuestion, handleDeleteAcademyQuizQuestion, handleGetAcademyCourseProgressAll, handleGetAcademyEnrollments, handlePostAcademyEnrollment, handlePutAcademyEnrollment, handleDeleteAcademyEnrollment } = require('./handlers/academy');
const { handleGetTickets, handlePostTicket, handlePutTicket, handleDeleteTicket } = require('./handlers/tickets');
const { getNestedPath, formatQuestionnaireContext, handleGetPendingQuestionnaires, handlePostQuestionnaireResponse, handlePatchQuestionnaireAssignment, handleGetQuestionnaires, handleGenerateQuestionnaire, handleAiFillSku, handlePostQuestionnaire, handlePutQuestionnaire, handleDeleteQuestionnaire, handleGetQuestionnaireQuestions, handlePostQuestionnaireQuestion, handlePutQuestionnaireQuestion, handleDeleteQuestionnaireQuestion, handlePutQuestionnaireQuestionsReorder, handlePostQuestionnaireAssignment, handleGetQuestionnaireAssignments, handleGetQuestionnaireResponses } = require('./handlers/questionnaires');
const { handleGetSavedReports, handlePostSavedReport, handlePutSavedReport, handleDeleteSavedReport, handlePostAdminReport } = require('./handlers/reports');
const { handleGetHealthPlanTemplates, handlePostHealthPlanTemplate, handlePutHealthPlanTemplate, handleDeleteHealthPlanTemplate, handleGetHealthPlans, handlePostJoinHealthPlan, handleGetHealthPlanDetail, handlePutHealthPlan, handlePatchPlanReminder, handlePostHealthPlanCheckin, handlePostHealthPlanMilestone, handleGetCoachClientPlans, handleGetHealthReports, handleGetHealthReport, handlePostHealthReport } = require('./handlers/health-plans');
const { handleGetLabProviders, handlePostLabProvider, handlePutLabProvider, handleDeleteLabProvider, handleGetLabUserMappings, handlePostLabUserMapping, handleDeleteLabUserMapping, handleGetLabReports, handleLabImportEvent } = require('./handlers/labs');
const { handleGetInventoryStock, handlePostInventoryStock, handleGetWarehouses, handlePostWarehouse, handlePutWarehouse, handleDeleteWarehouse } = require('./handlers/inventory');
const { handleGetOrders, handleGetMyOrders, handlePostStoreItem, handlePutStoreItem, handleDeleteStoreItem, handleGetSkus, handlePostSku, handlePutSku, handleDeleteSku } = require('./handlers/store');
const { handleGetCommissionSettings, handlePutCommissionSetting, handleGetCoachCommissions, handleGetChannelCommissions, handleGetCoachEarnings, handleGetCoachPayouts, handleGetChannelPayouts, handlePostGenerateCoachPayouts, handlePostGenerateChannelPayouts, handlePutCoachPayout, handlePutChannelPayout } = require('./handlers/commissions');
const { handleGetPartners, handleGetPartner, handleGetPartnerByPhone, handlePostPartner, handlePostPartnerGcnProvision, handlePostPartnerInviteCode, handleGcnPartnerInviteCode, handleGcnPartnerApply, handlePostPartnerSale, handlePutPartner, handleDeletePartner, handleGetPartnerCommissions, handlePostPartnerCommission, handleGetPartnerPayouts, handlePostGeneratePartnerPayouts, handlePutPartnerPayout, handleGcnPartnerChildren, handleGcnPartnerDescendants, handleGetChannelReferralNetwork, handleGetPartnerCommissionConfig, handlePutPartnerCommissionConfig, handleGetPartnerTypes, handlePostPartnerType, handlePutPartnerType, handleDeletePartnerType, handleGetPartnerCommissionRules, handlePostPartnerCommissionRule, handlePutPartnerCommissionRule, handleDeletePartnerCommissionRule, handlePutChannelPartnerSystemPermission, handleGetChannelRewardsSummary } = require('./handlers/partners');
const { handleGetEvents, handlePostEvent, handlePutEvent, handleDeleteEvent, handleGetEventSignups, handlePostEventSignup, handleDeleteEventSignup, handleGetMyEventSignups } = require('./handlers/events');
const { handleGetCoachGroups, handlePostCoachGroup, handlePutCoachGroup, handleDeleteCoachGroup, handleGetCoachGroupKpis } = require('./handlers/coach-groups');
const { handleGetKoneApkReleases, handlePostKoneApkRelease, handlePutKoneApkRelease, handleDeleteKoneApkRelease, handleGetKoneApkPresign, handleGetDigitalAssets, handlePostDigitalAsset, handlePutDigitalAsset, handleDeleteDigitalAsset, handleGetDigitalAssetsPresign, handleGetKinoUpgrade } = require('./handlers/digital-assets');
const { logActivity, handleGetCoachTags, handlePostCoachTag, handlePutCoachTag, handleDeleteCoachTag, handlePostCoachTagAssignments, handleDeleteCoachTagAssignment, handleGetClientPipeline, handlePostClientPipeline, handleGetCoachNotes, handlePostCoachNote, handlePutCoachNote, handleDeleteCoachNote, handleGetClientActivity, handleGetCoachActivityFeed, handleGetMessageTemplates, handlePostMessageTemplate, handlePutMessageTemplate, handleDeleteMessageTemplate, handlePostMessageTemplatePreview, resolveBulkRecipients, handlePostBulkCampaign, handlePostBulkCampaignSend, handleGetBulkCampaigns, handleGetBulkCampaignRecipients, handleGetAppointments, handlePostAppointment, handlePutAppointment, handleDeleteAppointment, handleGetUpcomingAppointments, handleGetClientGoals, handlePostClientGoal, handlePutClientGoal, handleDeleteClientGoal, refreshGoalProgress, handlePostNpsSurvey, handlePatchNpsSurvey, handleGetNpsSurveys, handleGetCoachKpis, handlePostCoachKpisCompute, handleGetFollowUpRules, handlePostFollowUpRule, handlePutFollowUpRule, handleDeleteFollowUpRule, handlePostFollowUpRulesEvaluate } = require('./handlers/crm');
const { handleGetKinoDevices, handlePostKinoDevice, handlePutKinoDevice, handleDeleteKinoDevice, handleGetKinoChipBatches, handleGetKinoChipBatchChips, handlePostKinoChipBatch, handlePutKinoChipBatch, handleDeleteKinoChipBatch, handleGetKinoChipModels, handlePostKinoChipModel, handlePutKinoChipModel, handleDeleteKinoChipModel, handleGetKinoChip, handlePostKinoScan, handlePostKinoResult, handleGetKinoTestedChips, handleGetKinoTestedChipDetail, handlePostKinoChipReset } = require('./handlers/kino');
const { handleGetCreditBalance, handleGetCreditHistory, handlePostCreditWithdraw, handleGetUserWithdrawals, handleGetAdminWithdrawals, handlePutAdminWithdrawal, handleGetAdminUserCreditHistory, handlePostAdminUserCreditAdjustment } = require('./handlers/credits');
const { handleGetAdminAccounts, handlePostAdminAccount, handlePutAdminAccount, handleDeleteAdminAccount, handleGetAdminChannelRoles, handlePostAdminChannelRole, handlePutAdminChannelRole, handleDeleteAdminChannelRole, handleAdminLogin } = require('./handlers/admin-accounts');
const { handleGetChannels, handlePostChannel, handlePutChannel, handleDeleteChannel, handlePutChannelManageSubchannels, handlePutChannelAdminTabs, handlePutChannelSubAgeLabels, handleGetChannelRewardsConfig, handlePutChannelRewardsConfig, handlePutChannelRewardsPermission, handlePutChannelStorePermission, handlePutChannelAutonomous, handlePutChannelWarehousePermission, handleGetChannelPartnerTiersConfig, handlePutChannelPartnerTiersConfig, handlePutChannelPartnerTiersPermission } = require('./handlers/channels');
const { handleGetUsers, handleGetDashboardStats, handleGetUser, handleGetBiomarkers, handleGetNotifications, handlePostUsers, handlePutUser, handlePatchUser, handleDeleteUser, handleGetInvitations, handlePostInvitation, handlePatchInvitation, handleDeleteInvitation } = require('./handlers/users');
const { handleGetDotsInventory, handleGetMyCartridges, handlePostCartridgeInsert, handlePostCartridgeRemove, handlePostDispense, handleGetStoreItems, handleGetStoreItemsByChannel, handleGetChannelInventory, handlePostChannelInventory, handlePutChannelInventory, handleDeleteChannelInventory, handlePutOrder, handlePostOrder, handlePostOrderBatch, handleGetNutritionPlan, handlePostFormulaDots, handlePostDots, handlePutDot, handleDeleteDot } = require('./handlers/dots');
const { handleGetCoachList, handleGetChannelUsers, handleGetChannelCoaches, handleGetCoachUsers, handlePostCoachInstruction, handleGetCoachSentMessages, handlePostReminder, handleGetReminders, handleGetCoachUserChat, handlePostAssignCoach, handlePostCoaches, handlePutCoach, handleDeleteCoach } = require('./handlers/coaches');
const { handleResolvePhone, handleBindPhone, handleWxLogin, handleWxAppLogin, handleValidateInvite, handleGetMyReferrals, handlePostWebviewToken, handleExchangeWebviewToken, handlePostAdminWebviewToken, handleExchangeAdminWebviewToken, handlePostQrLoginInit, handleGetQrLoginStatus, handlePostQrLoginConfirm } = require('./handlers/login');
const { handlePhoneOtpSend, handlePhoneOtpVerify } = require('./handlers/phone-otp');
const { saveChatMessage, fetchTagDerivationContext, resolveOrUpsertUser, handleGetChatHistory, handlePostBiomarkers, handlePostChat, handlePostChatMessages, handlePostHeartbeat, handlePostHealthAdvice, handlePostAnalyzeImage, handlePostHealthEvent, handlePostHealthEventsSync, handleGetHealthEvents, handleGetHealthTwin, handleGetOssPresign } = require('./handlers/chat');


// ── Admin dashboard stats (time series + distributions) ─────────────────────
// Read-only aggregates for the admin panel Dashboard tab. Channel admins are
// scoped to their own channel via adminCtx.channelId; superadmins see all.


// MONTH_EN, WEEKDAY_EN, WEEKDAY_ZH → moved to handlers/dots.js


// ─────────────────────────────────────────────────────────────────────────────
// COACH CRM — extracted to handlers/crm.js
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────





// WeChat Open Platform (mobile app / fluwx) login. Unlike the miniapp's
// jscode2session, the OAuth code is exchanged via sns/oauth2/access_token and
// yields a DIFFERENT openid (stored in users.wx_app_openid). Cross-client
// account matching: wx_app_openid → wx_unionid → phone.


exports.handler = async (req, resp, context) => {
    const isStandardHttp = resp && typeof resp.send === 'function';
    let event = req;

    if (Buffer.isBuffer(req)) {
        try { event = JSON.parse(req.toString()); } catch (e) {}
    }

    // EventBridge CloudEvent detection — route before HTTP processing
    if (event && event.specversion && event.source) {
        let cloudData = event.data;
        if (Buffer.isBuffer(cloudData)) cloudData = JSON.parse(cloudData.toString('utf8'));
        else if (typeof cloudData === 'string') {
            try { cloudData = JSON.parse(Buffer.from(cloudData, 'base64').toString('utf8')); }
            catch (e) { try { cloudData = JSON.parse(cloudData); } catch (e2) {} }
        }
        if (event.source === 'acs.lab' && event.type === 'biomarker.lab_complete') {
            try {
                await handleLabImportEvent(cloudData, fetchTagDerivationContext);
            } catch (err) {
                console.error(JSON.stringify({ level: 'ERROR', msg: 'handleLabImportEvent failed', error: err.message }));
            }
        }
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }), isBase64Encoded: false };
    }

    const rawUrl = req.url || '';
    const urlPath = rawUrl.split('?')[0];
    const urlParams = rawUrl.includes('?')
        ? Object.fromEntries(new URLSearchParams(rawUrl.split('?')[1]))
        : {};

    const rawPath = event.rawPath || event.path || (event.requestContext && event.requestContext.path) || req.path || urlPath || '';
    const path = rawPath.replace(/^\/api/, '');
    const method = event.httpMethod || event.method || (event.requestContext && event.requestContext.http && event.requestContext.http.method) || req.method || 'POST';
    const body = event.body || (isStandardHttp ? req.body : event);
    const query = event.queryParameters || event.queryStringParameters || req.queries || req.query || urlParams || {};

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    if (method === 'OPTIONS') {
        const optionsPayload = {
            isBase64Encoded: false,
            statusCode: 204,
            headers: corsHeaders,
            body: ''
        };
        if (isStandardHttp) {
            resp.setStatusCode(204);
            Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v));
            resp.send('');
            return;
        }
        return optionsPayload;
    }

    // WeChat business domain verification file — no auth required
    if (method === 'GET' && rawPath === '/QJaeMN3iR8.txt') {
        const wxVerifyPayload = { isBase64Encoded: false, statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'e038f3e1651b72fc26feaf9eb6cf30e7' };
        if (isStandardHttp) { resp.setStatusCode(200); resp.setHeader('Content-Type', 'text/plain'); resp.send('e038f3e1651b72fc26feaf9eb6cf30e7'); return; }
        return wxVerifyPayload;
    }

    // WeChat business domain verification file for Aeviva — no auth required
    if (method === 'GET' && rawPath === '/y8OA62rIU4.txt') {
        const wxVerifyPayload = { isBase64Encoded: false, statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: 'e11d7813414b959e5a6440f6c2cd2b30' };
        if (isStandardHttp) { resp.setStatusCode(200); resp.setHeader('Content-Type', 'text/plain'); resp.send('e11d7813414b959e5a6440f6c2cd2b30'); return; }
        return wxVerifyPayload;
    }

    // Public certificate verification — no auth required
    if (method === 'GET' && path.match(/^\/academy\/verify\/(.+)/)) {
        const certNumber = decodeURIComponent(path.match(/^\/academy\/verify\/(.+)/)[1]);
        const verifyResult = await handleVerifyCertificate(certNumber);
        const sc = verifyResult.statusCode || (verifyResult.success ? 200 : 404);
        const verifyPayload = { isBase64Encoded: false, statusCode: sc, headers: corsHeaders, body: JSON.stringify(verifyResult) };
        if (isStandardHttp) { resp.setStatusCode(sc); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify(verifyResult)); return; }
        return verifyPayload;
    }

    // Public certificate verification by government ID — no auth required, exact match only
    if (method === 'GET' && path.match(/^\/academy\/verify-by-id\/(.+)/)) {
        const governmentId = decodeURIComponent(path.match(/^\/academy\/verify-by-id\/(.+)/)[1]);
        const byIdResult = await handleVerifyCertificatesByGovernmentId(governmentId);
        const sc = byIdResult.statusCode || (byIdResult.success ? 200 : 404);
        const byIdPayload = { isBase64Encoded: false, statusCode: sc, headers: corsHeaders, body: JSON.stringify(byIdResult) };
        if (isStandardHttp) { resp.setStatusCode(sc); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify(byIdResult)); return; }
        return byIdPayload;
    }

    // Public certificate image URL — no auth required (same visibility as verify)
    if (method === 'GET' && path.match(/^\/academy\/cert-image\/(.+)/)) {
        const certNumber = decodeURIComponent(path.match(/^\/academy\/cert-image\/(.+)/)[1]);
        const imageResult = await handleGetCertImageUrl(certNumber);
        const sc = imageResult.statusCode || (imageResult.success ? 200 : 404);
        const imagePayload = { isBase64Encoded: false, statusCode: sc, headers: corsHeaders, body: JSON.stringify(imageResult) };
        if (isStandardHttp) { resp.setStatusCode(sc); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify(imageResult)); return; }
        return imagePayload;
    }

    const adminCtx = { role: 'superadmin', username: 'superadmin', channelId: null, accountId: null, canManageSubchannels: false };
    const expectedBearer = process.env.API_BEARER_TOKEN;
    if (expectedBearer && rawPath && path !== '/admin/login' && !path.startsWith('/qr-login/') && !path.startsWith('/phone-otp/')) {
        const authHeader = (event.headers && (event.headers['authorization'] || event.headers['Authorization'])) || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (token === expectedBearer) {
            adminCtx.role = 'superadmin';
        } else if (process.env.GCN_API_TOKEN && token === process.env.GCN_API_TOKEN) {
            // Scoped nano<-GCN service credential — distinct from API_BEARER_TOKEN (nano's
            // full superadmin bearer). Authenticated but restricted to the exact paths GCN's
            // nanoClient.js actually calls; anything else 403s even with a valid token.
            const GCN_ALLOWED_PATHS = new Set(['/exchange-webview-token', '/exchange-admin-webview-token', '/partner-sales', '/partner-invite-code-gcn', '/partner-applications', '/partner-children-gcn', '/partner-descendants-gcn']);
            if (!GCN_ALLOWED_PATHS.has(path)) {
                const forbiddenPayload = { isBase64Encoded: false, statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'Forbidden' }) };
                if (isStandardHttp) { resp.setStatusCode(403); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify({ error: 'Forbidden' })); return; }
                return forbiddenPayload;
            }
            adminCtx.role = 'superadmin';
            adminCtx.username = 'gcn-service';
        } else if (token.startsWith('ch.')) {
            const payload = verifyChannelAdminToken(token);
            if (!payload) {
                const unauthorizedPayload = { isBase64Encoded: false, statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
                if (isStandardHttp) { resp.setStatusCode(401); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify({ error: 'Unauthorized' })); return; }
                return unauthorizedPayload;
            }
            adminCtx.role = 'channel';
            adminCtx.username = payload.username || payload.sub;
            adminCtx.channelId = payload.cid;
            adminCtx.accountId = payload.sub;
            adminCtx.autonomous = payload.auto ?? false;
            adminCtx.canManageSubchannels = adminCtx.autonomous || (payload.cms ?? false);
            adminCtx.canManageWarehouses = adminCtx.autonomous || (payload.cmw ?? false);
            adminCtx.tabs = payload.tabs ?? [];
            adminCtx.perms = adminCtx.autonomous
                ? [...CHANNEL_ADMIN_FULL_PERMS]
                : (Array.isArray(payload.perms) ? payload.perms : expandPermissions(payload.tabs ?? []));
        } else {
            const unauthorizedPayload = { isBase64Encoded: false, statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Unauthorized' }) };
            if (isStandardHttp) { resp.setStatusCode(401); Object.entries(corsHeaders).forEach(([k, v]) => resp.setHeader(k, v)); resp.send(JSON.stringify({ error: 'Unauthorized' })); return; }
            return unauthorizedPayload;
        }
    }

    try {
        let result;

        let parsedBody = body;
        if (method !== 'GET') {
            if (Buffer.isBuffer(body)) {
                try { parsedBody = JSON.parse(body.toString()); } catch (e) { console.error('Failed to parse Buffer body', e); }
            } else if (typeof body === 'string') {
                try { parsedBody = JSON.parse(body); } catch (e) { console.error('Failed to parse string body', e); }
            }
        }

        // Superadmin "login as" sandbox sessions tag every mutating request with
        // sandbox:true so nothing they do persists against the impersonated user's
        // real account. /chat is excluded — it needs to still call the LLM and
        // return a reply; its own writes are suppressed inside handlePostChat.
        const sandbox = (parsedBody && parsedBody.sandbox === true) || query.sandbox === 'true';

        if (sandbox && method !== 'GET' && path !== '/chat') {
            result = { success: true, sandbox: true };
        } else if (method === 'GET') {
            if (path === '/kino-upgrade') {
                result = await handleGetKinoUpgrade();
            } else if (path.includes('/kone-apk-releases')) {
                result = await handleGetKoneApkReleases();
            } else if (path.includes('/oss/kone-apk/presign')) {
                result = await handleGetKoneApkPresign();
            } else if (path === '/digital-assets/presign') {
                result = await handleGetDigitalAssetsPresign(query);
            } else if (path === '/digital-assets') {
                result = await handleGetDigitalAssets(query, adminCtx);
            } else if (path.includes('/kino-devices')) {
                result = await handleGetKinoDevices();
            } else if (path.match(/\/kino-chip-batches\/(\d+)\/chips/)) {
                const batchId = path.match(/\/kino-chip-batches\/(\d+)\/chips/)[1];
                result = await handleGetKinoChipBatchChips(batchId, query);
            } else if (path.includes('/kino-chip-batches')) {
                result = await handleGetKinoChipBatches();
            } else if (path.includes('/kino-chip-models')) {
                result = await handleGetKinoChipModels();
            } else if (path.match(/\/kino-tested-chips\/(\d+)/)) {
                const scanId = path.match(/\/kino-tested-chips\/(\d+)/)[1];
                result = await handleGetKinoTestedChipDetail(scanId);
            } else if (path.includes('/kino-tested-chips')) {
                result = await handleGetKinoTestedChips(query);
            } else if (path.includes('/kino-chip')) {
                result = await handleGetKinoChip(query.chip_id);
            } else if (path.includes('/coach-sent-messages')) {
                result = await handleGetCoachSentMessages(query.user_id);
            } else if (path.includes('/coach-user-chat')) {
                result = await handleGetCoachUserChat(query.user_id, query.coach_id);
            } else if (path.includes('/chat-history')) {
                const sinceId = query.since_id ? parseInt(query.since_id, 10) : null;
                const beforeId = query.before_id ? parseInt(query.before_id, 10) : null;
                result = await handleGetChatHistory(query.openid, sinceId, beforeId);
            } else if (path.includes('/biomarkers')) {
                result = await handleGetBiomarkers(query.openid);
            } else if (path.includes('/notifications')) {
                result = await handleGetNotifications(query.openid);
            } else if (path.includes('/reminders')) {
                result = await handleGetReminders(query.openid);
            } else if (path.includes('/nutrition-plan')) {
                result = await handleGetNutritionPlan(query.openid);
            } else if (path === '/health-twin') {
                result = await handleGetHealthTwin(query.openid);
            } else if (path.match(/\/health-reports\/(\d+)/)) {
                const reportId = path.match(/\/health-reports\/(\d+)/)[1];
                result = await handleGetHealthReport(reportId, query);
            } else if (path === '/lab/reports') {
                result = await handleGetLabReports(query);
            } else if (path.includes('/health-reports')) {
                result = await handleGetHealthReports(query);
            } else if (path.includes('/lab-providers')) {
                result = await handleGetLabProviders();
            } else if (path.includes('/lab-user-mappings')) {
                result = await handleGetLabUserMappings(query);
            } else if (path.includes('/health-events')) {
                result = await handleGetHealthEvents(query);
            } else if (path.match(/\/health-plans\/(\d+)/)) {
                const planId = path.match(/\/health-plans\/(\d+)/)[1];
                result = await handleGetHealthPlanDetail(planId, query.openid);
            } else if (path.includes('/health-plans')) {
                result = await handleGetHealthPlans(query);
            } else if (path.includes('/health-plan-templates')) {
                result = await handleGetHealthPlanTemplates(query);
            } else if (path.includes('/coach-client-plans')) {
                result = await handleGetCoachClientPlans(query.coach_id);
            } else if (path.includes('/my-cartridges')) {
                result = await handleGetMyCartridges(query.openid);
            } else if (path.includes('/dots-inventory')) {
                result = await handleGetDotsInventory();
            } else if (path.includes('/channel-inventory')) {
                result = await handleGetChannelInventory(query, adminCtx);
            } else if (path.includes('/skus')) {
                result = await handleGetSkus(adminCtx);
            } else if (path.includes('/inventory-stock')) {
                result = await handleGetInventoryStock(query, adminCtx);
            } else if (path === '/warehouses') {
                result = await handleGetWarehouses();
            } else if (path.includes('/store-items/by-channel')) {
                result = await handleGetStoreItemsByChannel(query);
            } else if (path.includes('/store-items')) {
                result = await handleGetStoreItems(query);
            } else if (path.includes('/my-orders')) {
                result = await handleGetMyOrders(query.openid);
            } else if (path.includes('/orders')) {
                result = await handleGetOrders(query, adminCtx);
            } else if (path.includes('/coach-list')) {
                result = await handleGetCoachList(adminCtx.channelId);
            } else if (path.match(/\/channel-users\/(\d+)/)) {
                result = await handleGetChannelUsers(path.match(/\/channel-users\/(\d+)/)[1], query);
            } else if (path.match(/\/channel-coaches\/(\d+)/)) {
                result = await handleGetChannelCoaches(path.match(/\/channel-coaches\/(\d+)/)[1], query.include_subchannels === 'true');
            } else if (path.match(/\/coach-users\/(\d+)/)) {
                result = await handleGetCoachUsers(path.match(/\/coach-users\/(\d+)/)[1], query);
            } else if (path.includes('/my-referrals')) {
                result = await handleGetMyReferrals(query);
            } else if (path === '/qr-login/status') {
                result = await handleGetQrLoginStatus(query.session_id);
            } else if (path === '/credits/balance') {
                result = await handleGetCreditBalance(query);
            } else if (path === '/credits/history') {
                result = await handleGetCreditHistory(query);
            } else if (path === '/credits/withdrawals') {
                result = await handleGetUserWithdrawals(query);
            } else if (path === '/admin/credit-withdrawals') {
                const wdQuery = adminCtx.channelId ? { ...query, channel_id: adminCtx.channelId } : query;
                result = await handleGetAdminWithdrawals(wdQuery);
            } else if (path.match(/\/admin\/users\/([^/]+)\/credit-history/)) {
                const uid = path.match(/\/admin\/users\/([^/]+)\/credit-history/)[1];
                result = await handleGetAdminUserCreditHistory(uid, adminCtx);
            } else if (path.includes('/invitations')) {
                const invQuery = adminCtx.channelId ? { ...query, channel_id: adminCtx.channelId } : query;
                result = await handleGetInvitations(invQuery);
            } else if (path === '/partner-types') {
                result = await handleGetPartnerTypes(query, adminCtx);
            } else if (path === '/partner-commission-rules') {
                result = await handleGetPartnerCommissionRules(query, adminCtx);
            } else if (path.includes('/partner-commission-config')) {
                result = await handleGetPartnerCommissionConfig();
            } else if (path.includes('/channel-referral-network')) {
                const cid = adminCtx.role === 'superadmin' ? query.channel_id : adminCtx.channelId;
                result = requirePermission(adminCtx, 'users:read') || await handleGetChannelReferralNetwork(cid);
            } else if (path.match(/\/partners\/by-phone\/([^/]+)/)) {
                result = await handleGetPartnerByPhone(decodeURIComponent(path.match(/\/partners\/by-phone\/([^/]+)/)[1]), query.channel);
            } else if (path.match(/\/partners\/(\d+)/)) {
                result = await handleGetPartner(path.match(/\/partners\/(\d+)/)[1]);
            } else if (path.includes('/partner-commissions')) {
                const pcQuery = adminCtx.channelId ? { ...query, channel_id: adminCtx.channelId } : query;
                result = await handleGetPartnerCommissions(pcQuery);
            } else if (path.includes('/partner-payouts')) {
                const ppQuery = adminCtx.channelId ? { ...query, channel_id: adminCtx.channelId } : query;
                result = await handleGetPartnerPayouts(ppQuery);
            } else if (path.includes('/partners')) {
                result = await handleGetPartners(query, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/rewards-config$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/rewards-config$/)[1];
                result = await handleGetChannelRewardsConfig(channelId, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/partner-tiers-config$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/partner-tiers-config$/)[1];
                result = await handleGetChannelPartnerTiersConfig(channelId, adminCtx);
            } else if (path.includes('/channels')) {
                result = await handleGetChannels(adminCtx);
            } else if (path.includes('/academy/course-progress')) {
                result = await handleGetAcademyCourseProgressAll();
            } else if (path.includes('/academy/courses')) {
                result = await handleGetAcademyCourses();
            } else if (path.match(/\/academy\/library\/(\d+)\/content/)) {
                const libId = path.match(/\/academy\/library\/(\d+)\/content/)[1];
                result = await handleGetAcademyLibraryContent(libId);
            } else if (path.includes('/academy/library')) {
                result = await handleGetAcademyLibrary();
            } else if (path.match(/\/academy\/lessons\/(\d+)$/)) {
                const lessonId = path.match(/\/academy\/lessons\/(\d+)$/)[1];
                result = await handleGetAcademyLessonById(lessonId);
            } else if (path.includes('/academy/lessons')) {
                result = await handleGetAcademyLessons(query.course_id);
            } else if (path.includes('/academy/progress')) {
                result = await handleGetAcademyProgress(query.user_id);
            } else if (path.includes('/academy/leaderboard')) {
                result = await handleGetAcademyLeaderboard();
            } else if (path.includes('/academy/coach-dashboard')) {
                result = await handleGetCoachDashboard(query.user_id);
            } else if (path.includes('/academy/coach-credits')) {
                result = await handleGetCoachCredits(query.user_id);
            } else if (path.includes('/academy/coach-certifications')) {
                result = await handleGetCoachCertifications(query.user_id);
            } else if (path.includes('/academy/issued-certifications')) {
                result = await handleGetIssuedCertifications(adminCtx);
            } else if (path.includes('/academy/enrollments')) {
                result = await handleGetAcademyEnrollments(adminCtx);
            } else if (path.match(/\/academy\/certifications\/(\d+)\/template-image/)) {
                const certId = path.match(/\/academy\/certifications\/(\d+)\/template-image/)[1];
                result = await handleGetAcademyTemplateImage(certId);
            } else if (path.includes('/academy/certifications')) {
                result = await handleGetAcademyCertifications();
            } else if (path.includes('/academy/learning-paths')) {
                result = await handleGetAcademyLearningPaths();
            } else if (path.includes('/oss/presign')) {
                result = await handleGetOssPresign(query);
            } else if (path.match(/\/users\/([^/]+)/)) {
                const userId = path.match(/\/users\/([^/]+)/)[1];
                result = await handleGetUser(userId);
            } else if (path.includes('/users') || path === '/' || path === '') {
                result = await handleGetUsers(adminCtx.channelId, query);
            } else if (path.includes('/commission-settings')) {
                result = await handleGetCommissionSettings();
            } else if (path.includes('/coach-commissions')) {
                const ccQuery = adminCtx.channelId ? { ...query, channel_id: adminCtx.channelId } : query;
                result = await handleGetCoachCommissions(ccQuery);
            } else if (path.includes('/channel-commissions')) {
                result = await handleGetChannelCommissions(query);
            } else if (path.includes('/coach-earnings')) {
                result = await handleGetCoachEarnings(query.coach_user_id);
            } else if (path.includes('/coach-payouts')) {
                result = await handleGetCoachPayouts(query);
            } else if (path.includes('/channel-payouts')) {
                const cpQuery = adminCtx.channelId ? { ...query, channel_id: adminCtx.channelId } : query;
                result = await handleGetChannelPayouts(cpQuery);
            } else if (path.includes('/channel-rewards-summary')) {
                result = await handleGetChannelRewardsSummary(query.channel_id);
            } else if (path === '/admin/dashboard-stats') {
                result = await handleGetDashboardStats(query, adminCtx);
            } else if (path === '/admin/saved-reports') {
                result = await handleGetSavedReports();
            } else if (path === '/admin-accounts') {
                result = await handleGetAdminAccounts(adminCtx);
            } else if (path === '/admin-channel-roles') {
                result = await handleGetAdminChannelRoles(adminCtx);
            } else if (path === '/tickets' || path.includes('/tickets')) {
                result = await handleGetTickets(adminCtx.channelId);
            } else if (path.includes('/pending-questionnaires')) {
                result = await handleGetPendingQuestionnaires(query.openid);
            } else if (path.match(/\/questionnaires\/(\d+)\/questions/)) {
                const qid = path.match(/\/questionnaires\/(\d+)\/questions/)[1];
                result = await handleGetQuestionnaireQuestions(qid);
            } else if (path.includes('/questionnaires')) {
                result = await handleGetQuestionnaires(query);
            } else if (path.includes('/questionnaire-assignments')) {
                result = await handleGetQuestionnaireAssignments(query);
            } else if (path.includes('/questionnaire-responses')) {
                result = await handleGetQuestionnaireResponses(query);
            } else if (path.includes('/coach-tags') && !path.includes('/coach-tag-assignments')) {
                result = await handleGetCoachTags(query.coach_id);
            } else if (path.includes('/coach-tag-assignments')) {
                result = { success: false, error: 'Use DELETE for tag assignment removal', statusCode: 405 };
            } else if (path.includes('/client-pipeline')) {
                result = await handleGetClientPipeline(query.coach_id);
            } else if (path.includes('/coach-notes')) {
                result = await handleGetCoachNotes(query);
            } else if (path.includes('/client-activity')) {
                result = await handleGetClientActivity(query);
            } else if (path.includes('/coach-activity-feed')) {
                result = await handleGetCoachActivityFeed(query.coach_id, query.limit);
            } else if (path.includes('/message-templates')) {
                result = await handleGetMessageTemplates(query);
            } else if (path.match(/\/bulk-campaigns\/(\d+)\/recipients/)) {
                const campId = path.match(/\/bulk-campaigns\/(\d+)\/recipients/)[1];
                result = await handleGetBulkCampaignRecipients(campId);
            } else if (path.includes('/bulk-campaigns')) {
                result = await handleGetBulkCampaigns(query.coach_id);
            } else if (path === '/appointments/upcoming') {
                result = await handleGetUpcomingAppointments(query.coach_id);
            } else if (path.includes('/appointments')) {
                result = await handleGetAppointments(query);
            } else if (path.includes('/client-goals')) {
                result = await handleGetClientGoals(query);
            } else if (path.includes('/nps-surveys')) {
                result = await handleGetNpsSurveys(query, adminCtx);
            } else if (path.includes('/coach-group-kpis')) {
                result = await handleGetCoachGroupKpis(query);
            } else if (path.includes('/coach-groups')) {
                result = await handleGetCoachGroups(query, adminCtx);
            } else if (path.includes('/coach-kpis')) {
                result = await handleGetCoachKpis(query);
            } else if (path === '/release-notes') {
                result = adminCtx.role !== 'superadmin'
                    ? { statusCode: 403, success: false, error: 'Permission denied: superadmin only' }
                    : await (async () => {
                        const { rows } = await pool.query(
                            'SELECT version, title, summary, published_at FROM release_notes ORDER BY published_at DESC'
                        );
                        return { success: true, entries: rows };
                    })();
            } else if (path.includes('/follow-up-rules')) {
                result = await handleGetFollowUpRules(query.coach_id);
            } else if (path.includes('/my-event-signups')) {
                result = await handleGetMyEventSignups(query);
            } else if (path.match(/\/events\/(\d+)\/signups/)) {
                const evId = path.match(/\/events\/(\d+)\/signups/)[1];
                result = requirePermission(adminCtx, 'events:read') || await handleGetEventSignups(evId);
            } else if (path.includes('/events')) {
                // Allow user-level access when openid is present (browsing channel events)
                result = query.openid
                    ? await handleGetEvents({ ...query, user_id: query.openid }, adminCtx)
                    : requirePermission(adminCtx, 'events:read') || await handleGetEvents(query, adminCtx);
            } else {
                result = { success: false, error: `Unknown GET route: ${path}` };
            }
        } else if (method === 'POST') {
            if (path === '/admin/login') {
                result = await handleAdminLogin(parsedBody);
            } else if (path === '/admin-accounts') {
                result = await handlePostAdminAccount(parsedBody, adminCtx);
            } else if (path === '/admin-channel-roles') {
                result = await handlePostAdminChannelRole(parsedBody, adminCtx);
            } else if (path === '/validate-invite') {
                result = await handleValidateInvite(parsedBody);
            } else if (path === '/wx-app-login') {
                result = await handleWxAppLogin(parsedBody);
            } else if (path === '/wx-login') {
                result = await handleWxLogin(parsedBody);
            } else if (path === '/webview-token') {
                result = await handlePostWebviewToken(parsedBody);
            } else if (path === '/exchange-webview-token') {
                result = await handleExchangeWebviewToken(parsedBody);
            } else if (path === '/admin-webview-token') {
                result = await handlePostAdminWebviewToken(parsedBody, adminCtx);
            } else if (path === '/exchange-admin-webview-token') {
                result = await handleExchangeAdminWebviewToken(parsedBody);
            } else if (path === '/qr-login/init') {
                result = await handlePostQrLoginInit(parsedBody);
            } else if (path === '/qr-login/confirm') {
                result = await handlePostQrLoginConfirm(parsedBody);
            } else if (path === '/phone-otp/send') {
                result = await handlePhoneOtpSend(parsedBody);
            } else if (path === '/phone-otp/verify') {
                result = await handlePhoneOtpVerify(parsedBody);
            } else if (path === '/resolve-phone') {
                const { code, app_id } = parsedBody;
                result = await handleResolvePhone(code, app_id);
            } else if (path === '/bind-phone') {
                const { user_id, code, app_id, phone: rawPhone } = parsedBody;
                result = await handleBindPhone(user_id, code, app_id, rawPhone);
            } else if (path.includes('/reminders')) {
                result = await handlePostReminder(parsedBody);
            } else if (path.includes('/coach-instruction')) {
                result = await handlePostCoachInstruction(parsedBody);
            } else if (path.includes('/assign-coach')) {
                result = await handlePostAssignCoach(parsedBody);
            } else if (path.includes('/invitations')) {
                result = requireAdminTab(adminCtx, 'invites') || await handlePostInvitation(parsedBody, adminCtx);
            } else if (path.includes('/channels')) {
                result = await handlePostChannel(parsedBody, adminCtx);
            } else if (path.includes('/coach-groups')) {
                result = await handlePostCoachGroup(parsedBody, adminCtx);
            } else if (path.includes('/coaches')) {
                result = requireAdminTab(adminCtx, 'coaches') || await handlePostCoaches(parsedBody);
            } else if (path.includes('/channel-inventory')) {
                result = requireAdminTab(adminCtx, 'store') || await handlePostChannelInventory(parsedBody, adminCtx);
            } else if (path.includes('/skus')) {
                result = await handlePostSku(parsedBody, adminCtx);
            } else if (path.includes('/inventory-stock')) {
                result = await handlePostInventoryStock(parsedBody, adminCtx);
            } else if (path === '/warehouses') {
                result = (adminCtx.role !== 'superadmin' && !adminCtx.canManageWarehouses)
                    ? { statusCode: 403, success: false, error: 'Permission denied' }
                    : await handlePostWarehouse(parsedBody);
            } else if (path.includes('/store-items')) {
                result = adminCtx.role !== 'superadmin'
                    ? { statusCode: 403, success: false, error: 'Permission denied: superadmin only' }
                    : await handlePostStoreItem(parsedBody);
            } else if (path === '/orders/batch') {
                result = await handlePostOrderBatch(parsedBody);
            } else if (path.includes('/orders')) {
                result = await handlePostOrder(parsedBody);
            } else if (path.includes('/dots')) {
                result = await handlePostDots(parsedBody);
            } else if (path === '/users') {
                result = requireAdminTab(adminCtx, 'users') || await handlePostUsers(parsedBody);
            } else if (path.includes('/kone-apk-releases')) {
                result = await handlePostKoneApkRelease(parsedBody);
            } else if (path === '/digital-assets') {
                result = await handlePostDigitalAsset(parsedBody, adminCtx);
            } else if (path.includes('/kino-chip-batches')) {
                result = await handlePostKinoChipBatch(parsedBody);
            } else if (path.includes('/kino-chip-models')) {
                result = await handlePostKinoChipModel(parsedBody);
            } else if (path.match(/\/kino-tested-chips\/(\d+)\/reset/)) {
                const scanId = path.match(/\/kino-tested-chips\/(\d+)\/reset/)[1];
                result = await handlePostKinoChipReset(scanId);
            } else if (path.includes('/kino-devices')) {
                result = await handlePostKinoDevice(parsedBody);
            } else if (path.includes('/kino-result')) {
                result = await handlePostKinoResult(parsedBody);
            } else if (path.includes('/kino-scan')) {
                result = await handlePostKinoScan(parsedBody);
            } else if (path === '/heartbeat') {
                result = await handlePostHeartbeat(parsedBody);
            } else if (path.includes('/chat-messages')) {
                result = await handlePostChatMessages(parsedBody);
            } else if (path.includes('/cartridge-insert')) {
                result = await handlePostCartridgeInsert(parsedBody);
            } else if (path.includes('/cartridge-remove')) {
                result = await handlePostCartridgeRemove(parsedBody);
            } else if (path.includes('/dispense')) {
                result = await handlePostDispense(parsedBody);
            } else if (path.includes('/formula-dots')) {
                result = await handlePostFormulaDots(parsedBody);
            } else if (path.match(/\/health-plans\/(\d+)\/checkin/)) {
                const planId = path.match(/\/health-plans\/(\d+)\/checkin/)[1];
                result = await handlePostHealthPlanCheckin(planId, parsedBody);
            } else if (path.match(/\/health-plans\/(\d+)\/milestone/)) {
                const planId = path.match(/\/health-plans\/(\d+)\/milestone/)[1];
                result = await handlePostHealthPlanMilestone(planId, parsedBody);
            } else if (path === '/health-events/fhir') {
                result = await handlePostHealthReport({ ...parsedBody, source: 'fhir_import' });
            } else if (path === '/health-reports') {
                result = await handlePostHealthReport(parsedBody, { handleLabImportEvent, fetchTagDerivationContext });
            } else if (path === '/lab-providers') {
                result = await handlePostLabProvider(parsedBody);
            } else if (path === '/lab-user-mappings') {
                result = await handlePostLabUserMapping(parsedBody);
            } else if (path === '/health-events/sync') {
                result = await handlePostHealthEventsSync(parsedBody);
            } else if (path === '/health-events') {
                result = await handlePostHealthEvent(parsedBody);
            } else if (path.includes('/health-plans')) {
                result = await handlePostJoinHealthPlan(parsedBody);
            } else if (path.includes('/health-plan-templates')) {
                result = await handlePostHealthPlanTemplate(parsedBody);
            } else if (path.includes('/health-advice')) {
                result = await handlePostHealthAdvice(parsedBody);
            } else if (path.includes('/analyze-image')) {
                result = await handlePostAnalyzeImage(parsedBody);
            } else if (path === '/biomarkers') {
                result = await handlePostBiomarkers(parsedBody);
            } else if (path === '/credits/withdraw') {
                result = await handlePostCreditWithdraw(parsedBody);
            } else if (path.match(/\/admin\/users\/([^/]+)\/credit-adjustments/)) {
                const uid = path.match(/\/admin\/users\/([^/]+)\/credit-adjustments/)[1];
                result = await handlePostAdminUserCreditAdjustment(uid, parsedBody, adminCtx);
            } else if (path.includes('/generate-coach-payouts')) {
                result = await handlePostGenerateCoachPayouts(parsedBody);
            } else if (path.includes('/generate-channel-payouts')) {
                const gcBody = adminCtx.channelId ? { channel_id: adminCtx.channelId, ...parsedBody } : parsedBody;
                result = await handlePostGenerateChannelPayouts(gcBody);
            } else if (path.includes('/generate-partner-payouts')) {
                const gpBody = adminCtx.channelId ? { channel_id: adminCtx.channelId, ...parsedBody } : parsedBody;
                result = await handlePostGeneratePartnerPayouts(gpBody);
            } else if (path === '/partner-types') {
                result = await handlePostPartnerType(parsedBody, adminCtx);
            } else if (path === '/partner-commission-rules') {
                result = await handlePostPartnerCommissionRule(parsedBody, adminCtx);
            } else if (path.match(/\/partners\/(\d+)\/gcn-provision/)) {
                result = await handlePostPartnerGcnProvision(path.match(/\/partners\/(\d+)\/gcn-provision/)[1]);
            } else if (path.match(/\/partners\/(\d+)\/invite-code/)) {
                result = await handlePostPartnerInviteCode(path.match(/\/partners\/(\d+)\/invite-code/)[1]);
            } else if (path.includes('/partner-invite-code-gcn')) {
                result = await handleGcnPartnerInviteCode(parsedBody);
            } else if (path.includes('/partner-children-gcn')) {
                result = await handleGcnPartnerChildren(parsedBody);
            } else if (path.includes('/partner-descendants-gcn')) {
                result = await handleGcnPartnerDescendants(parsedBody);
            } else if (path.includes('/partner-applications')) {
                result = await handleGcnPartnerApply(parsedBody);
            } else if (path.includes('/partner-sales')) {
                result = await handlePostPartnerSale(parsedBody);
            } else if (path.includes('/partner-commissions')) {
                result = await handlePostPartnerCommission(parsedBody);
            } else if (path.includes('/partners')) {
                result = await handlePostPartner(parsedBody, adminCtx);
            } else if (path === '/academy/courses') {
                result = await handlePostAcademyCourse(parsedBody);
            } else if (path === '/academy/library') {
                result = await handlePostAcademyLibraryItem(parsedBody);
            } else if (path === '/academy/lessons') {
                result = await handlePostAcademyLesson(parsedBody);
            } else if (path === '/academy/progress') {
                result = await handlePostAcademyProgress(parsedBody);
            } else if (path === '/academy/quiz-attempts') {
                result = await handlePostQuizAttempt(parsedBody);
            } else if (path === '/academy/lesson-quizzes') {
                result = await handlePostAcademyQuizQuestion(parsedBody);
            } else if (path === '/academy/certifications') {
                result = await handlePostAcademyCertification(parsedBody);
            } else if (path === '/academy/enrollments') {
                result = await handlePostAcademyEnrollment(parsedBody, adminCtx);
            } else if (path === '/academy/coach-certifications') {
                result = await handlePostCoachCertification(parsedBody, adminCtx);
            } else if (path === '/academy/learning-paths') {
                result = await handlePostAcademyLearningPath(parsedBody);
            } else if (path === '/tickets') {
                result = await handlePostTicket(parsedBody, adminCtx);
            } else if (path.match(/\/questionnaires\/(\d+)\/questions/)) {
                const qid = path.match(/\/questionnaires\/(\d+)\/questions/)[1];
                result = await handlePostQuestionnaireQuestion(qid, parsedBody);
            } else if (path === '/admin/ai-fill-sku') {
                result = await handleAiFillSku(parsedBody);
            } else if (path === '/questionnaires/generate') {
                result = await handleGenerateQuestionnaire(parsedBody);
            } else if (path === '/questionnaires') {
                result = await handlePostQuestionnaire(parsedBody);
            } else if (path === '/questionnaire-responses') {
                result = await handlePostQuestionnaireResponse(parsedBody, saveChatMessage);
            } else if (path === '/questionnaire-assignments') {
                result = await handlePostQuestionnaireAssignment(parsedBody);
            } else if (path === '/admin/saved-reports') {
                result = await handlePostSavedReport(parsedBody);
            } else if (path === '/admin/report') {
                result = await handlePostAdminReport(parsedBody);
            } else if (path.includes('/coach-tags') && !path.includes('/coach-tag-assignments')) {
                result = await handlePostCoachTag(parsedBody);
            } else if (path.includes('/coach-tag-assignments')) {
                result = await handlePostCoachTagAssignments(parsedBody);
            } else if (path.includes('/client-pipeline')) {
                result = await handlePostClientPipeline(parsedBody);
            } else if (path.includes('/coach-notes')) {
                result = await handlePostCoachNote(parsedBody);
            } else if (path.match(/\/message-templates\/(\d+)\/preview/)) {
                const tplId = path.match(/\/message-templates\/(\d+)\/preview/)[1];
                result = await handlePostMessageTemplatePreview(tplId, parsedBody);
            } else if (path.includes('/message-templates')) {
                result = await handlePostMessageTemplate(parsedBody);
            } else if (path.match(/\/bulk-campaigns\/(\d+)\/send/)) {
                const campId = path.match(/\/bulk-campaigns\/(\d+)\/send/)[1];
                result = await handlePostBulkCampaignSend(campId);
            } else if (path.includes('/bulk-campaigns')) {
                result = await handlePostBulkCampaign(parsedBody);
            } else if (path.includes('/appointments')) {
                result = await handlePostAppointment(parsedBody);
            } else if (path.includes('/client-goals')) {
                result = await handlePostClientGoal(parsedBody);
            } else if (path.includes('/nps-surveys')) {
                result = await handlePostNpsSurvey(parsedBody);
            } else if (path === '/coach-kpis/compute') {
                result = await handlePostCoachKpisCompute(parsedBody);
            } else if (path === '/follow-up-rules/evaluate') {
                result = await handlePostFollowUpRulesEvaluate();
            } else if (path.includes('/follow-up-rules')) {
                result = await handlePostFollowUpRule(parsedBody);
            } else if (path.includes('/event-signups')) {
                result = await handlePostEventSignup(parsedBody);
            } else if (path.includes('/events')) {
                result = requirePermission(adminCtx, 'events:write') || await handlePostEvent(parsedBody, adminCtx);
            } else {
                result = await handlePostChat(parsedBody);
            }
        } else if (method === 'PUT') {
            if (path.match(/\/digital-assets\/(\d+)/)) {
                const assetId = path.match(/\/digital-assets\/(\d+)/)[1];
                result = await handlePutDigitalAsset(assetId, parsedBody, adminCtx);
            } else if (path.match(/\/kone-apk-releases\/(\d+)/)) {
                const releaseId = path.match(/\/kone-apk-releases\/(\d+)/)[1];
                result = await handlePutKoneApkRelease(releaseId, parsedBody);
            } else if (path.match(/\/kino-chip-batches\/(\d+)/)) {
                const batchId = path.match(/\/kino-chip-batches\/(\d+)/)[1];
                result = await handlePutKinoChipBatch(batchId, parsedBody);
            } else if (path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)) {
                const code = path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)[1];
                result = await handlePutKinoChipModel(code, parsedBody);
            } else if (path.includes('/kino-devices/')) {
                const deviceId = path.split('/kino-devices/')[1];
                result = await handlePutKinoDevice(deviceId, parsedBody);
            } else if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = requireAdminTab(adminCtx, 'users') || await handlePutUser(user_id, parsedBody);
            } else if (path.match(/\/coach-groups\/(\d+)/)) {
                const groupId = path.match(/\/coach-groups\/(\d+)/)[1];
                result = await handlePutCoachGroup(groupId, parsedBody, adminCtx);
            } else if (path.includes('/coaches/')) {
                const coachId = path.split('/coaches/')[1];
                result = requireAdminTab(adminCtx, 'coaches') || await handlePutCoach(coachId, parsedBody);
            } else if (path.match(/\/channels\/(\d+)\/sub-age-labels$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/sub-age-labels$/)[1];
                result = await handlePutChannelSubAgeLabels(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/admin-tabs$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/admin-tabs$/)[1];
                result = await handlePutChannelAdminTabs(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/rewards-config$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/rewards-config$/)[1];
                result = await handlePutChannelRewardsConfig(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/rewards-permission$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/rewards-permission$/)[1];
                result = await handlePutChannelRewardsPermission(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/partner-tiers-config$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/partner-tiers-config$/)[1];
                result = await handlePutChannelPartnerTiersConfig(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/partner-tiers-permission$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/partner-tiers-permission$/)[1];
                result = await handlePutChannelPartnerTiersPermission(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/partner-system-permission$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/partner-system-permission$/)[1];
                result = await handlePutChannelPartnerSystemPermission(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/store-permission$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/store-permission$/)[1];
                result = await handlePutChannelStorePermission(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/autonomous$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/autonomous$/)[1];
                result = await handlePutChannelAutonomous(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/warehouse-permission$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/warehouse-permission$/)[1];
                result = await handlePutChannelWarehousePermission(channelId, parsedBody, adminCtx);
            } else if (path.match(/\/channels\/(\d+)\/manage-subchannels$/)) {
                const channelId = path.match(/\/channels\/(\d+)\/manage-subchannels$/)[1];
                result = await handlePutChannelManageSubchannels(channelId, parsedBody, adminCtx);
            } else if (path.includes('/channels/')) {
                const channelId = path.split('/channels/')[1];
                result = await handlePutChannel(channelId, parsedBody, adminCtx);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handlePutDot(dotId, parsedBody);
            } else if (path.includes('/channel-inventory/')) {
                const invId = path.split('/channel-inventory/')[1];
                result = requireAdminTab(adminCtx, 'store') || await handlePutChannelInventory(invId, parsedBody, adminCtx);
            } else if (path.includes('/skus/')) {
                const skuId = path.split('/skus/')[1];
                result = await handlePutSku(skuId, parsedBody, adminCtx);
            } else if (path.match(/\/warehouses\/(\d+)$/)) {
                const wId = path.match(/\/warehouses\/(\d+)$/)[1];
                result = (adminCtx.role !== 'superadmin' && !adminCtx.canManageWarehouses)
                    ? { statusCode: 403, success: false, error: 'Permission denied' }
                    : await handlePutWarehouse(wId, parsedBody);
            } else if (path.includes('/store-items/')) {
                const itemId = path.split('/store-items/')[1];
                result = adminCtx.role !== 'superadmin'
                    ? { statusCode: 403, success: false, error: 'Permission denied: superadmin only' }
                    : await handlePutStoreItem(itemId, parsedBody);
            } else if (path.includes('/orders/')) {
                const orderId = path.split('/orders/')[1];
                result = requireAdminTab(adminCtx, 'store') || await handlePutOrder(orderId, parsedBody, adminCtx);
            } else if (path.match(/\/admin\/credit-withdrawals\/([a-f0-9-]+)/i)) {
                const wdId = path.match(/\/admin\/credit-withdrawals\/([a-f0-9-]+)/i)[1];
                result = await handlePutAdminWithdrawal(wdId, parsedBody, adminCtx);
            } else if (path.includes('/commission-settings/')) {
                const settingId = path.split('/commission-settings/')[1];
                result = await handlePutCommissionSetting(settingId, parsedBody);
            } else if (path.includes('/coach-payouts/')) {
                const payoutId = path.split('/coach-payouts/')[1];
                result = await handlePutCoachPayout(payoutId, parsedBody);
            } else if (path.includes('/channel-payouts/')) {
                const payoutId = path.split('/channel-payouts/')[1];
                result = await handlePutChannelPayout(payoutId, parsedBody);
            } else if (path.match(/\/partner-types\/([^/]+)$/)) {
                const typeKey = path.match(/\/partner-types\/([^/]+)$/)[1];
                result = await handlePutPartnerType(typeKey, parsedBody, adminCtx);
            } else if (path.match(/\/partner-commission-rules\/(\d+)$/)) {
                const ruleId = path.match(/\/partner-commission-rules\/(\d+)$/)[1];
                result = await handlePutPartnerCommissionRule(ruleId, parsedBody, adminCtx);
            } else if (path.includes('/partner-commission-config')) {
                result = await handlePutPartnerCommissionConfig(parsedBody);
            } else if (path.includes('/partner-payouts/')) {
                const payoutId = path.split('/partner-payouts/')[1];
                result = await handlePutPartnerPayout(payoutId, parsedBody);
            } else if (path.includes('/partners/')) {
                const partnerId = path.split('/partners/')[1];
                result = await handlePutPartner(partnerId, parsedBody);
            } else if (path.includes('/academy/lessons/')) {
                const lessonId = path.split('/academy/lessons/')[1];
                result = await handlePutAcademyLesson(lessonId, parsedBody);
            } else if (path.includes('/academy/courses/')) {
                const courseId = path.split('/academy/courses/')[1];
                result = await handlePutAcademyCourse(courseId, parsedBody);
            } else if (path.includes('/academy/library/')) {
                const libId = path.split('/academy/library/')[1];
                result = await handlePutAcademyLibraryItem(libId, parsedBody);
            } else if (path.match(/\/academy\/lesson-quizzes\/(\d+)/)) {
                const qId = path.match(/\/academy\/lesson-quizzes\/(\d+)/)[1];
                result = await handlePutAcademyQuizQuestion(qId, parsedBody);
            } else if (path.match(/\/academy\/enrollments\/(\d+)/)) {
                const enrollId = path.match(/\/academy\/enrollments\/(\d+)/)[1];
                result = await handlePutAcademyEnrollment(enrollId, parsedBody, adminCtx);
            } else if (path.match(/\/academy\/coach-certifications\/(\d+)/)) {
                const issuedId = path.match(/\/academy\/coach-certifications\/(\d+)/)[1];
                result = await handlePutCoachCertification(issuedId, parsedBody, adminCtx);
            } else if (path.match(/\/academy\/certifications\/(\d+)/)) {
                const certId = path.match(/\/academy\/certifications\/(\d+)/)[1];
                result = await handlePutAcademyCertification(certId, parsedBody);
            } else if (path.match(/\/academy\/learning-paths\/(\d+)/)) {
                const pathId = path.match(/\/academy\/learning-paths\/(\d+)/)[1];
                result = await handlePutAcademyLearningPath(pathId, parsedBody);
            } else if (path.match(/\/admin\/saved-reports\/(\d+)/)) {
                const rId = path.match(/\/admin\/saved-reports\/(\d+)/)[1];
                result = await handlePutSavedReport(rId, parsedBody);
            } else if (path.includes('/admin-accounts/')) {
                const accountId = path.split('/admin-accounts/')[1];
                result = await handlePutAdminAccount(accountId, parsedBody, adminCtx);
            } else if (path.match(/\/admin-channel-roles\/(\d+)/)) {
                const roleId = path.match(/\/admin-channel-roles\/(\d+)/)[1];
                result = await handlePutAdminChannelRole(roleId, parsedBody, adminCtx);
            } else if (path.match(/\/tickets\/(\d+)/)) {
                const ticketId = path.match(/\/tickets\/(\d+)/)[1];
                result = await handlePutTicket(ticketId, parsedBody);
            } else if (path === '/questionnaire-questions/reorder') {
                result = await handlePutQuestionnaireQuestionsReorder(parsedBody);
            } else if (path.match(/\/questionnaire-questions\/(\d+)/)) {
                const qqId = path.match(/\/questionnaire-questions\/(\d+)/)[1];
                result = await handlePutQuestionnaireQuestion(qqId, parsedBody);
            } else if (path.match(/\/questionnaires\/(\d+)/)) {
                const qId = path.match(/\/questionnaires\/(\d+)/)[1];
                result = await handlePutQuestionnaire(qId, parsedBody);
            } else if (path.match(/\/health-plans\/(\d+)/)) {
                const planId = path.match(/\/health-plans\/(\d+)/)[1];
                result = await handlePutHealthPlan(planId, parsedBody);
            } else if (path.match(/\/health-plan-templates\/(\d+)/)) {
                const tplId = path.match(/\/health-plan-templates\/(\d+)/)[1];
                result = await handlePutHealthPlanTemplate(tplId, parsedBody);
            } else if (path.match(/\/coach-tags\/(\d+)/)) {
                const tagId = path.match(/\/coach-tags\/(\d+)/)[1];
                result = await handlePutCoachTag(tagId, parsedBody);
            } else if (path.match(/\/coach-notes\/(\d+)/)) {
                const noteId = path.match(/\/coach-notes\/(\d+)/)[1];
                result = await handlePutCoachNote(noteId, parsedBody);
            } else if (path.match(/\/message-templates\/(\d+)/)) {
                const tplId = path.match(/\/message-templates\/(\d+)/)[1];
                result = await handlePutMessageTemplate(tplId, parsedBody);
            } else if (path.match(/\/appointments\/(\d+)/)) {
                const apptId = path.match(/\/appointments\/(\d+)/)[1];
                result = await handlePutAppointment(apptId, parsedBody);
            } else if (path.match(/\/client-goals\/(\d+)/)) {
                const goalId = path.match(/\/client-goals\/(\d+)/)[1];
                result = await handlePutClientGoal(goalId, parsedBody);
            } else if (path.match(/\/follow-up-rules\/(\d+)/)) {
                const ruleId = path.match(/\/follow-up-rules\/(\d+)/)[1];
                result = await handlePutFollowUpRule(ruleId, parsedBody);
            } else if (path.match(/\/lab-providers\/(\d+)/)) {
                const pid = path.match(/\/lab-providers\/(\d+)/)[1];
                result = await handlePutLabProvider(pid, parsedBody);
            } else if (path.match(/\/events\/(\d+)/)) {
                const evId = path.match(/\/events\/(\d+)/)[1];
                result = requirePermission(adminCtx, 'events:write') || await handlePutEvent(evId, parsedBody);
            } else {
                result = { success: false, error: `Unknown PUT route: ${path}` };
            }
        } else if (method === 'DELETE') {
            if (path.match(/\/digital-assets\/(\d+)/)) {
                const assetId = path.match(/\/digital-assets\/(\d+)/)[1];
                result = await handleDeleteDigitalAsset(assetId, adminCtx);
            } else if (path.match(/\/kone-apk-releases\/(\d+)/)) {
                const releaseId = path.match(/\/kone-apk-releases\/(\d+)/)[1];
                result = await handleDeleteKoneApkRelease(releaseId);
            } else if (path.match(/\/kino-chip-batches\/(\d+)/)) {
                const batchId = path.match(/\/kino-chip-batches\/(\d+)/)[1];
                result = await handleDeleteKinoChipBatch(batchId);
            } else if (path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)) {
                const code = path.match(/\/kino-chip-models\/([A-Z0-9]+)/i)[1];
                result = await handleDeleteKinoChipModel(code);
            } else if (path.includes('/kino-devices/')) {
                const deviceId = path.split('/kino-devices/')[1];
                result = await handleDeleteKinoDevice(deviceId);
            } else if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = requirePermission(adminCtx, 'users:delete') || await handleDeleteUser(user_id);
            } else if (path.match(/\/coach-groups\/(\d+)/)) {
                const groupId = path.match(/\/coach-groups\/(\d+)/)[1];
                result = await handleDeleteCoachGroup(groupId, adminCtx);
            } else if (path.includes('/coaches/')) {
                const coachId = path.split('/coaches/')[1];
                result = requirePermission(adminCtx, 'coaches:delete') || await handleDeleteCoach(coachId);
            } else if (path.includes('/channels/')) {
                const channelId = path.split('/channels/')[1];
                result = await handleDeleteChannel(channelId, adminCtx);
            } else if (path.match(/\/partner-types\/([^/]+)$/)) {
                const typeKey = path.match(/\/partner-types\/([^/]+)$/)[1];
                result = await handleDeletePartnerType(typeKey, adminCtx);
            } else if (path.match(/\/partner-commission-rules\/(\d+)$/)) {
                const ruleId = path.match(/\/partner-commission-rules\/(\d+)$/)[1];
                result = await handleDeletePartnerCommissionRule(ruleId, adminCtx);
            } else if (path.includes('/partners/')) {
                const partnerId = path.split('/partners/')[1];
                result = await handleDeletePartner(partnerId);
            } else if (path.includes('/dots/')) {
                const dotId = path.split('/dots/')[1];
                result = await handleDeleteDot(dotId);
            } else if (path.includes('/invitations/')) {
                const inviteId = path.split('/invitations/')[1];
                result = requirePermission(adminCtx, 'invites:delete') || await handleDeleteInvitation(inviteId);
            } else if (path.includes('/channel-inventory/')) {
                const invId = path.split('/channel-inventory/')[1];
                result = requirePermission(adminCtx, 'store:delete') || await handleDeleteChannelInventory(invId, adminCtx);
            } else if (path.includes('/skus/')) {
                const skuId = path.split('/skus/')[1];
                result = await handleDeleteSku(skuId, adminCtx);
            } else if (path.match(/\/warehouses\/(\d+)$/)) {
                const wId = path.match(/\/warehouses\/(\d+)$/)[1];
                result = (adminCtx.role !== 'superadmin' && !adminCtx.canManageWarehouses)
                    ? { statusCode: 403, success: false, error: 'Permission denied' }
                    : await handleDeleteWarehouse(wId);
            } else if (path.includes('/store-items/')) {
                const itemId = path.split('/store-items/')[1];
                result = adminCtx.role !== 'superadmin'
                    ? { statusCode: 403, success: false, error: 'Permission denied: superadmin only' }
                    : await handleDeleteStoreItem(itemId);
            } else if (path.includes('/academy/lessons/')) {
                const lessonId = path.split('/academy/lessons/')[1];
                result = await handleDeleteAcademyLesson(lessonId);
            } else if (path.includes('/academy/courses/')) {
                const courseId = path.split('/academy/courses/')[1];
                result = await handleDeleteAcademyCourse(courseId);
            } else if (path.includes('/academy/library/')) {
                const libId = path.split('/academy/library/')[1];
                result = await handleDeleteAcademyLibraryItem(libId);
            } else if (path.match(/\/academy\/lesson-quizzes\/(\d+)/)) {
                const qId = path.match(/\/academy\/lesson-quizzes\/(\d+)/)[1];
                result = await handleDeleteAcademyQuizQuestion(qId);
            } else if (path.match(/\/academy\/enrollments\/(\d+)/)) {
                const enrollId = path.match(/\/academy\/enrollments\/(\d+)/)[1];
                result = await handleDeleteAcademyEnrollment(enrollId, adminCtx);
            } else if (path.match(/\/academy\/certifications\/(\d+)/)) {
                const certId = path.match(/\/academy\/certifications\/(\d+)/)[1];
                result = await handleDeleteAcademyCertification(certId);
            } else if (path.match(/\/academy\/learning-paths\/(\d+)/)) {
                const pathId = path.match(/\/academy\/learning-paths\/(\d+)/)[1];
                result = await handleDeleteAcademyLearningPath(pathId);
            } else if (path.match(/\/admin\/saved-reports\/(\d+)/)) {
                const rId = path.match(/\/admin\/saved-reports\/(\d+)/)[1];
                result = await handleDeleteSavedReport(rId);
            } else if (path.includes('/admin-accounts/')) {
                const accountId = path.split('/admin-accounts/')[1];
                result = await handleDeleteAdminAccount(accountId, adminCtx);
            } else if (path.match(/\/admin-channel-roles\/(\d+)/)) {
                const roleId = path.match(/\/admin-channel-roles\/(\d+)/)[1];
                result = await handleDeleteAdminChannelRole(roleId, adminCtx);
            } else if (path.match(/\/tickets\/(\d+)/)) {
                const ticketId = path.match(/\/tickets\/(\d+)/)[1];
                result = await handleDeleteTicket(ticketId);
            } else if (path.match(/\/questionnaire-questions\/(\d+)/)) {
                const qqId = path.match(/\/questionnaire-questions\/(\d+)/)[1];
                result = await handleDeleteQuestionnaireQuestion(qqId);
            } else if (path.match(/\/questionnaires\/(\d+)/)) {
                const qId = path.match(/\/questionnaires\/(\d+)/)[1];
                result = await handleDeleteQuestionnaire(qId);
            } else if (path.match(/\/health-plan-templates\/(\d+)/)) {
                const tplId = path.match(/\/health-plan-templates\/(\d+)/)[1];
                result = await handleDeleteHealthPlanTemplate(tplId);
            } else if (path.match(/\/coach-tags\/(\d+)/)) {
                const tagId = path.match(/\/coach-tags\/(\d+)/)[1];
                result = await handleDeleteCoachTag(tagId);
            } else if (path.includes('/coach-tag-assignments')) {
                result = await handleDeleteCoachTagAssignment(query);
            } else if (path.match(/\/coach-notes\/(\d+)/)) {
                const noteId = path.match(/\/coach-notes\/(\d+)/)[1];
                result = await handleDeleteCoachNote(noteId);
            } else if (path.match(/\/message-templates\/(\d+)/)) {
                const tplId = path.match(/\/message-templates\/(\d+)/)[1];
                result = await handleDeleteMessageTemplate(tplId);
            } else if (path.match(/\/appointments\/(\d+)/)) {
                const apptId = path.match(/\/appointments\/(\d+)/)[1];
                result = await handleDeleteAppointment(apptId);
            } else if (path.match(/\/client-goals\/(\d+)/)) {
                const goalId = path.match(/\/client-goals\/(\d+)/)[1];
                result = await handleDeleteClientGoal(goalId);
            } else if (path.match(/\/follow-up-rules\/(\d+)/)) {
                const ruleId = path.match(/\/follow-up-rules\/(\d+)/)[1];
                result = await handleDeleteFollowUpRule(ruleId);
            } else if (path.match(/\/lab-providers\/(\d+)/)) {
                const pid = path.match(/\/lab-providers\/(\d+)/)[1];
                result = await handleDeleteLabProvider(pid);
            } else if (path.match(/\/lab-user-mappings\/(\d+)/)) {
                const mid = path.match(/\/lab-user-mappings\/(\d+)/)[1];
                result = await handleDeleteLabUserMapping(mid);
            } else if (path.match(/\/event-signups\/(\d+)/)) {
                const evId = path.match(/\/event-signups\/(\d+)/)[1];
                result = requirePermission(adminCtx, 'events:write') || await handleDeleteEventSignup(evId, query.user_id);
            } else if (path.match(/\/events\/(\d+)/)) {
                const evId = path.match(/\/events\/(\d+)/)[1];
                result = requirePermission(adminCtx, 'events:delete') || await handleDeleteEvent(evId);
            } else {
                result = { success: false, error: `Unknown DELETE route: ${path}` };
            }
        } else if (method === 'PATCH') {
            if (path.includes('/users/')) {
                const user_id = path.split('/users/')[1];
                result = await handlePatchUser(user_id, parsedBody);
            } else if (path.includes('/invitations/')) {
                const inviteId = path.split('/invitations/')[1];
                result = requireAdminTab(adminCtx, 'invites') || await handlePatchInvitation(inviteId, parsedBody);
            } else if (path.match(/\/questionnaire-assignments\/(\d+)/)) {
                const aId = path.match(/\/questionnaire-assignments\/(\d+)/)[1];
                result = await handlePatchQuestionnaireAssignment(aId, parsedBody);
            } else if (path.match(/\/plan-reminders\/(\d+)/)) {
                const rId = path.match(/\/plan-reminders\/(\d+)/)[1];
                result = await handlePatchPlanReminder(rId, parsedBody);
            } else if (path.match(/\/nps-surveys\/(\d+)/)) {
                const surveyId = path.match(/\/nps-surveys\/(\d+)/)[1];
                result = await handlePatchNpsSurvey(surveyId, parsedBody);
            } else {
                result = { success: false, error: `Unknown PATCH route: ${path}` };
            }
        } else {
            result = { success: false, error: `Unknown route: ${method} ${path}` };
        }

        const statusCode = result.statusCode || 200;
        const { statusCode: _sc, _rawText, _rawBinary, contentType, content, ...resultBody } = result;
        const isText = _rawText === true;
        const isBinary = _rawBinary === true;
        const responseHeaders = isBinary
            ? { ...corsHeaders, 'Content-Type': contentType || 'application/octet-stream' }
            : isText
              ? { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' }
              : corsHeaders;
        const responsePayload = {
            isBase64Encoded: isBinary,
            statusCode,
            headers: responseHeaders,
            body: isBinary ? (content || '') : (isText ? (content || '') : JSON.stringify(resultBody))
        };

        if (isStandardHttp) {
            resp.setStatusCode(statusCode);
            Object.entries(responseHeaders).forEach(([k, v]) => resp.setHeader(k, v));
            resp.send(isBinary ? Buffer.from(responsePayload.body, 'base64') : responsePayload.body);
            return;
        }

        return responsePayload;

    } catch (error) {
        const errPayload = {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: error.message, debug: { path, method } })
        };
        if (isStandardHttp) {
            resp.setStatusCode(500);
            resp.send(errPayload.body);
            return;
        }
        return errPayload;
    }
};
