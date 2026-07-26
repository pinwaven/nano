/**
 * 24 Solar Terms (二十四节气) — fixed reference-date table.
 * Dates are widely-cited averages, accurate to within ~1 day in most years.
 * Sufficient for narrative/dietary framing; not for ritual/astrological timing.
 *
 * season -> dimension mapping is a pragmatic simplification (not strict TCM
 * canon) chosen to nudge one of Waven's four BioAge dimensions per season:
 *   春 Spring / 肝 Liver  -> ResilienceAge
 *   夏 Summer / 心 Heart  -> MicroVascularAge
 *   秋 Autumn / 肺 Lung   -> MetabolicAge
 *   冬 Winter / 肾 Kidney -> CellularAge
 */

const SOLAR_TERMS = [
    { key: 'XiaoHan', name_zh: '小寒', name_en: 'Minor Cold', month: 1, day: 6, season_zh: '冬', organ_zh: '肾', dimension: 'CellularAge', theme_zh: '一年中最冷时段将至，宜温补固本，忌过度发汗耗气' },
    { key: 'DaHan', name_zh: '大寒', name_en: 'Major Cold', month: 1, day: 20, season_zh: '冬', organ_zh: '肾', dimension: 'CellularAge', theme_zh: '冬季最后一个节气，宜继续温补肾精，为立春回阳做准备' },
    { key: 'LiChun', name_zh: '立春', name_en: 'Start of Spring', month: 2, day: 4, season_zh: '春', organ_zh: '肝', dimension: 'ResilienceAge', theme_zh: '万物复苏，宜疏肝理气，防"春困"，情绪舒缓' },
    { key: 'YuShui', name_zh: '雨水', name_en: 'Rain Water', month: 2, day: 19, season_zh: '春', organ_zh: '肝', dimension: 'ResilienceAge', theme_zh: '湿气渐生，健脾祛湿的同时不忘养肝，饮食宜清淡' },
    { key: 'JingZhe', name_zh: '惊蛰', name_en: 'Awakening of Insects', month: 3, day: 6, season_zh: '春', organ_zh: '肝', dimension: 'ResilienceAge', theme_zh: '阳气升发，易生"肝火"，宜清淡少辛辣，规律作息' },
    { key: 'ChunFen', name_zh: '春分', name_en: 'Spring Equinox', month: 3, day: 21, season_zh: '春', organ_zh: '肝', dimension: 'ResilienceAge', theme_zh: '阴阳平衡，情绪易波动，宜疏肝解郁，适度运动' },
    { key: 'QingMing', name_zh: '清明', name_en: 'Clear and Bright', month: 4, day: 5, season_zh: '春', organ_zh: '肝', dimension: 'ResilienceAge', theme_zh: '肝气最旺，宜养肝护肝，防"倒春寒"，忌燥热' },
    { key: 'GuYu', name_zh: '谷雨', name_en: 'Grain Rain', month: 4, day: 20, season_zh: '春', organ_zh: '肝', dimension: 'ResilienceAge', theme_zh: '春季最后一个节气，宜健脾养肝并重，为入夏做准备' },
    { key: 'LiXia', name_zh: '立夏', name_en: 'Start of Summer', month: 5, day: 6, season_zh: '夏', organ_zh: '心', dimension: 'MicroVascularAge', theme_zh: '阳气渐盛，养心为要，忌大喜大悲，饮食清淡' },
    { key: 'XiaoMan', name_zh: '小满', name_en: 'Minor Fullness', month: 5, day: 21, season_zh: '夏', organ_zh: '心', dimension: 'MicroVascularAge', theme_zh: '湿热渐重，防"苦夏"，宜清心健脾，睡眠充足' },
    { key: 'MangZhong', name_zh: '芒种', name_en: 'Grain in Ear', month: 6, day: 6, season_zh: '夏', organ_zh: '心', dimension: 'MicroVascularAge', theme_zh: '湿热交蒸，血脉易瘀滞，宜适度运动畅通气血' },
    { key: 'XiaZhi', name_zh: '夏至', name_en: 'Summer Solstice', month: 6, day: 21, season_zh: '夏', organ_zh: '心', dimension: 'MicroVascularAge', theme_zh: '阳气最盛，心火易旺，宜静心宁神，午间小憩养心' },
    { key: 'XiaoShu', name_zh: '小暑', name_en: 'Minor Heat', month: 7, day: 7, season_zh: '夏', organ_zh: '心', dimension: 'MicroVascularAge', theme_zh: '暑湿渐盛，血脉运行加快，注意补水与心血管养护' },
    { key: 'DaShu', name_zh: '大暑', name_en: 'Major Heat', month: 7, day: 23, season_zh: '夏', organ_zh: '心', dimension: 'MicroVascularAge', theme_zh: '全年最热，暑热耗气伤津，宜清热解暑，护心防中暑' },
    { key: 'LiQiu', name_zh: '立秋', name_en: 'Start of Autumn', month: 8, day: 8, season_zh: '秋', organ_zh: '肺', dimension: 'MetabolicAge', theme_zh: '暑去凉来，代谢渐趋平缓，宜润肺滋阴，忌燥热饮食' },
    { key: 'ChuShu', name_zh: '处暑', name_en: 'End of Heat', month: 8, day: 23, season_zh: '秋', organ_zh: '肺', dimension: 'MetabolicAge', theme_zh: '暑气渐消，宜早睡早起，调理代谢，为秋冬蓄力' },
    { key: 'BaiLu', name_zh: '白露', name_en: 'White Dew', month: 9, day: 8, season_zh: '秋', organ_zh: '肺', dimension: 'MetabolicAge', theme_zh: '昼夜温差增大，肺气渐弱，宜润肺益气，饮食温润' },
    { key: 'QiuFen', name_zh: '秋分', name_en: 'Autumn Equinox', month: 9, day: 23, season_zh: '秋', organ_zh: '肺', dimension: 'MetabolicAge', theme_zh: '阴阳再平衡，宜平补，忌大寒大热，代谢趋于收敛' },
    { key: 'HanLu', name_zh: '寒露', name_en: 'Cold Dew', month: 10, day: 8, season_zh: '秋', organ_zh: '肺', dimension: 'MetabolicAge', theme_zh: '露气寒冷，阳气渐收，宜温润食材，助力代谢平稳过渡' },
    { key: 'ShuangJiang', name_zh: '霜降', name_en: 'Frost’s Descent', month: 10, day: 23, season_zh: '秋', organ_zh: '肺', dimension: 'MetabolicAge', theme_zh: '秋季最后一个节气，宜进补但忌燥热，为冬藏做准备' },
    { key: 'LiDong', name_zh: '立冬', name_en: 'Start of Winter', month: 11, day: 8, season_zh: '冬', organ_zh: '肾', dimension: 'CellularAge', theme_zh: '阳气潜藏，宜"冬藏"，温补肾阳，早睡晚起' },
    { key: 'XiaoXue', name_zh: '小雪', name_en: 'Minor Snow', month: 11, day: 22, season_zh: '冬', organ_zh: '肾', dimension: 'CellularAge', theme_zh: '寒气渐盛，宜温补脾肾，注意保暖防寒邪' },
    { key: 'DaXue', name_zh: '大雪', name_en: 'Major Snow', month: 12, day: 7, season_zh: '冬', organ_zh: '肾', dimension: 'CellularAge', theme_zh: '进补佳期，宜滋阴补肾，为来年蓄养精气' },
    { key: 'DongZhi', name_zh: '冬至', name_en: 'Winter Solstice', month: 12, day: 22, season_zh: '冬', organ_zh: '肾', dimension: 'CellularAge', theme_zh: '阴气极盛，阳气始生，是全年温补肾阳的关键节点' },
];

/**
 * Returns the current solar term for a given date (defaults to now).
 * SOLAR_TERMS is already sorted by (month, day) ascending, which is also
 * chronological order within a Gregorian year (Jan's 小寒/大寒 sort first,
 * Dec's 冬至 sorts last). The only wraparound case is Jan 1–5, before 小寒
 * (Jan 6) — those days still belong to the previous solar year's 冬至.
 */
function getCurrentSolarTerm(date = new Date()) {
    const month = date.getMonth() + 1;
    const day = date.getDate();

    let current = null;
    for (const term of SOLAR_TERMS) {
        if (term.month < month || (term.month === month && term.day <= day)) {
            current = term;
        }
    }
    return current || SOLAR_TERMS[SOLAR_TERMS.length - 1];
}

module.exports = { SOLAR_TERMS, getCurrentSolarTerm };
