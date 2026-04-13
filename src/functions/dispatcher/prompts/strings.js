/**
 * Nano System Strings (Bilingual)
 */
module.exports = {
    analysis_complete: {
        en: (bioAge) => `Analysis complete! Your BioAge is **${bioAge}**. I have generated your 7-day precision nutrition plan below.`,
        zh: (bioAge) => `分析完成！您的生物年龄 (BioAge) 为 **${bioAge}**。我已在下方为您生成了 7 天精准营养方案。`
    },
    processing_data: {
        en: "I am processing your data. How can I assist you further?",
        zh: "我正在处理您的数据。还有什么我可以帮您的吗？"
    },
    llm_error_fallback: {
        en: (bioAge) => `I can see your BioAge is ${bioAge}. Let me know what specific questions you have!`,
        zh: (bioAge) => `我看到您的生物年龄是 ${bioAge}。如果您有任何具体问题，请告诉我！`
    }
};
