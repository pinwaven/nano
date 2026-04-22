'use strict';

/**
 * NanoFirstReport workflow — mirrors the Coze graph:
 *
 *   Start (input)
 *     ├─→ LLM_Report    (node 141434)   ─┐
 *     └─→ LLM_Nutrition (node 1474426)  ─┤
 *                                        ↓
 *          Code: report.replace("[Nutrient Placeholder]", nutrition)
 *                                        ↓
 *                                      End (merged string)
 *
 * Both LLM calls run in parallel; results are stitched by the code node logic.
 */

const OpenAI = require('openai');
const systemReport = require('../../../prompts/systemReport');
const systemNutrition = require('../../../prompts/systemNutrition');

// Lazy-init: client is created on first use so tests can mock before instantiation
let _client = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  }
  return _client;
}

/**
 * Call the Aliyun DashScope API (OpenAI-compatible) with a system prompt and user message.
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function callLLM(systemPrompt, userMessage) {
  const model = process.env.MODEL || 'qwen-turbo';
  const response = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });
  return response.choices[0].message.content;
}

/**
 * Run the full NanoFirstReport workflow.
 *
 * @param {object} input  The user profile + biomarker data
 * @returns {Promise<string>}  The final merged Markdown report
 */
async function runWorkflow(input) {
  const userMessage = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  const userProfile = input.user_profile || {};

  // Generate language-specific system prompts
  const reportPrompt = typeof systemReport === 'function' ? systemReport(userProfile) : systemReport;
  const nutritionPrompt = typeof systemNutrition === 'function' ? systemNutrition({ ...userProfile, ...input, dots_formulary: input.dots_formulary || [] }) : systemNutrition;

  // Nodes 141434 + 1474426: run both LLMs in parallel
  const [report, nutrition] = await Promise.all([
    callLLM(reportPrompt, userMessage),
    callLLM(nutritionPrompt, userMessage),
  ]);

  // Node 192660: stitch nutrition table into the placeholder
  return report.replace('[Nutrient Placeholder]', nutrition);
}

module.exports = { runWorkflow };
