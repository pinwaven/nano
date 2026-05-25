'use strict';
const DEFAULTS = {
    ResilienceAge:    '抗压年龄',
    CellularAge:      '细胞年龄',
    MetabolicAge:     '代谢年龄',
    MicroVascularAge: '微血管年龄',
};

function getVivaLabels(sub_age_display_names) {
    const get = key => sub_age_display_names?.[key]?.zh?.trim() || DEFAULTS[key];
    return {
        ResilienceAge:    get('ResilienceAge'),
        CellularAge:      get('CellularAge'),
        MetabolicAge:     get('MetabolicAge'),
        MicroVascularAge: get('MicroVascularAge'),
    };
}

module.exports = { getVivaLabels };
