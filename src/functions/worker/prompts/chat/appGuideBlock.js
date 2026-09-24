'use strict';

/**
 * Where things are in the app — so an app-usage question gets the real path instead of an
 * invented one. Found live on dev 2026-09-23 with a real user question, 「我的体检报告要传到哪里」:
 * routed casual_chat (correctly — the UNDERSTAND step's `app_usage` family, §47), and Viva
 * answered with an 「健康档案」→「体检报告」 section and a 「联系护理师」 button in the top-right
 * corner, neither of which exists. The essential block forbids inventing business details
 * (prices, delivery, promotions) but said nothing about the app's own screens, and the casual
 * template had no idea what they are, so the model made up a plausible app.
 *
 * The map is the WeChat Mini Program's, read from pages/main/main.wxml, components/user-health/
 * and components/health-documents/ — labels copied verbatim from their zh/en i18n tables. It is
 * rendered for `client === 'miniapp'`, which the web user-app also sends (its chat/useChat.js)
 * because it mirrors the miniapp's tabs and labels (its i18n is generated from the miniapp's).
 * Any other caller — the coach app sends no client — gets only the rule (describe no screen you
 * were not given).
 *
 * Keep it in step with the miniapp: a renamed tab or moved button here is a wrong answer there.
 * Deliberately no customer-service entry — the miniapp has none, which is why the essential
 * block's canned line says 联系客服 without naming a button.
 */
const MAP_ZH = `【App 使用指引 — 用户问「在哪里 / 怎么操作」时，只按下面的真实位置回答】
- 底部导航：对话 · 健康 · 方案 · 学习 · 补给。
- 对话页输入框旁的「＋」打开工具箱：上传图片、检测服务（Kino 芯片检测）、营养定制（生成原粒配方）、健康管理（完整健康分析）。
- 上传体检报告 / 化验单 / 病历：健康 → 数字孪生，页面最下方「健康文档」→「＋ 上传文档」。支持 PDF、Word、Excel、PPT 和图片；纸质报告可直接拍照上传；在微信小程序里，PDF 等文件需先发到「文件传输助手」或任意微信聊天，再回来选择（网页版可直接选文件）。上传后系统会解析其中的指标。
- 健康 → 数字孪生按四层展示：KINO 精准检测、日常监测、医疗记录、个人档案。智能戒指/手环在「日常监测」里点「绑定智能戒指」。
- 方案页有「方案」和「原粒」两个子页：健康方案的加入、打卡，以及当前原粒计划都在这里。
- 补给：商城与订单。
- 点击页面顶部的标题栏打开菜单：邀请好友、手机号管理、邮箱管理、兑换订阅码、字体大小、深浅色、语言切换、退出。
- 以上没有列出的功能、按钮或入口（例如在线客服、护理师、预约挂号），不要描述、不要猜测位置；直接说明你不确定它在 App 里的位置。`;

const MAP_EN = `[APP GUIDE — when the user asks where something is or how to do something in the app, answer only from these real locations]
- Bottom tabs: Chat · Health · Plans · Learn · Store.
- The "＋" next to the chat input opens the toolbox: Upload Image, Use Kino Chip, Formulate Dots, Health Advice.
- Uploading a checkup report / lab result / medical record: Health → Digital Twin, at the bottom "Health Records" → "＋ Upload record". PDF, Word, Excel, PPT and images are supported; a paper report can be photographed directly; inside the WeChat Mini Program a file must first be sent to "File Transfer" or any WeChat chat and then picked from there (the web app picks files directly). The system extracts its markers after upload.
- Health → Digital Twin shows four layers: KINO Precision Testing, Daily Monitoring, Medical Records, Personal Profile. A smart ring/band is bound under Daily Monitoring → "Bind Smart Ring".
- Plans has two sub-tabs, Plans and Dots: joining and checking in to health plans, and the current Dots plan.
- Store: shop and orders.
- Tapping the title bar at the top opens the menu: Invite Friends, Manage Phone Numbers, Manage Emails, Redeem Subscription Code, Text Size, dark/light mode, language, Logout.
- Any feature, button or entry not listed above (e.g. live customer service, a nurse, appointment booking): do not describe it or guess where it is — say plainly that you're not sure where it is in the app.`;

const RULE_ZH = `【App 使用指引】你看不到用户当前使用的界面。不要描述任何未在本提示词中给出的页面、菜单、按钮或入口；用户问某个功能在哪里时，直接说明你不确定它在界面上的位置。`;
const RULE_EN = `[APP GUIDE] You can't see the screen the user is on. Never describe a page, menu, button or entry this prompt did not give you; if asked where a feature is, say plainly that you're not sure where it is on screen.`;

function getAppGuideBlock({ client, isZh = true } = {}) {
    if (client === 'miniapp') return isZh ? MAP_ZH : MAP_EN;
    return isZh ? RULE_ZH : RULE_EN;
}

module.exports = { getAppGuideBlock };
