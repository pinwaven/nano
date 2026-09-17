-- Food vocabulary for chronic food-sensitivity (IgG) panels. CLAUDE.md §40.
--
-- WHY A TABLE AND NOT biomarker_catalog. A food is not a clinical marker. Three things make
-- them different in ways that break if they share a home:
--   1. healthTwinUpdater builds health_twin.latest_lab_data from ONLY the single most recent
--      lab_result date, so a 120-food panel dated after a user's 体检 would replace hsCRP,
--      LDL and eGFR in the twin's lab panel with food titres.
--   2. ref_low/ref_high express a normal range. A food IgG result is a printed ordinal class
--      0-3, and the bands differ by lab.
--   3. A food's actionable payload is what to eat instead of it — common_sources_zh /
--      substitutes_zh below — which no biomarker has.
--
-- IDENTITY. food_key is the stable handle, on the same rule as dots.key_name (§11): an
-- extracted item that resolves to nothing is DROPPED AND COUNTED, never guessed onto a
-- neighbouring food. `aliases` exists because the source is OCR of a printed report and the
-- same lab spells the same food two ways — this report prints 卵类粘蛋白 in the results table
-- and 卵类黏蛋白 in its own appendix, and 螃蟹 vs 蟹.
--
-- dot_conflict_keys IS DELIBERATELY EMPTY FOR EVERY ROW.
-- lib/formulationQuality.js's _collides is bidirectional substring containment over dot names
-- and ingredient names, and allergy_conflict is the one finding the caller acts on: it DELETES
-- the dot from both recipes. A bare food restriction "玉米" substring-matches the ingredient
-- 玉米黄质 and would silently remove DOT-N8 明眸 from someone's formula. So a food restriction
-- removes a dot only where a human has declared the link here. An empty list is a countable
-- gap; a prose match is a silent wrong deletion.
--
-- SEEDED FROM ONE REPORT, ON PURPOSE. The 120 rows are the exact panel of 慢性食物过敏（120项
-- IgG）. common_sources_zh / substitutes_zh are populated ONLY for the 21 foods that report's
-- own 食物明细表 covers; the other 99 are empty rather than invented. Filling them is clinical
-- content work, not a migration.

CREATE TABLE IF NOT EXISTS food_catalog (
    food_key          TEXT PRIMARY KEY,
    name_zh           TEXT NOT NULL,
    name_en           TEXT,
    category          TEXT NOT NULL,
    aliases           TEXT[] NOT NULL DEFAULT '{}',
    common_sources_zh TEXT[] NOT NULL DEFAULT '{}',
    substitutes_zh    TEXT[] NOT NULL DEFAULT '{}',
    dot_conflict_keys TEXT[] NOT NULL DEFAULT '{}',
    is_active         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- category: dairy_egg | fruit | vegetable | meat | seafood | grain_nut | other
-- Documented rather than CHECKed, matching biomarker_catalog.category's own treatment.

CREATE INDEX IF NOT EXISTS idx_food_catalog_active ON food_catalog (is_active, category);

INSERT INTO food_catalog (food_key, name_zh, name_en, category, aliases, common_sources_zh, substitutes_zh) VALUES
    ('casein', '酪蛋白', 'Casein', 'dairy_egg', ARRAY['干酪素']::TEXT[], ARRAY['牛奶','羊奶','双皮奶','奶酪']::TEXT[], ARRAY['豆浆','鸡蛋','虾皮']::TEXT[]),
    ('cow_milk', '牛奶', 'Cow milk', 'dairy_egg', ARRAY['牛乳','鲜奶']::TEXT[], '{}', '{}'),
    ('beta_lactoglobulin', 'β-乳球蛋白', 'Beta-lactoglobulin', 'dairy_egg', ARRAY['b-乳球蛋白','β乳球蛋白','beta-乳球蛋白']::TEXT[], ARRAY['牛奶及乳制品']::TEXT[], ARRAY['大米','土豆','红薯','山药']::TEXT[]),
    ('watermelon', '西瓜', 'Watermelon', 'fruit', '{}', '{}', '{}'),
    ('apple', '苹果', 'Apple', 'fruit', '{}', '{}', '{}'),
    ('mango', '芒果', 'Mango', 'fruit', '{}', '{}', '{}'),
    ('banana', '香蕉', 'Banana', 'fruit', '{}', '{}', '{}'),
    ('cantaloupe', '哈密瓜', 'Cantaloupe', 'fruit', ARRAY['甜瓜']::TEXT[], '{}', '{}'),
    ('grape', '葡萄', 'Grape', 'fruit', '{}', '{}', '{}'),
    ('lemon', '柠檬', 'Lemon', 'fruit', '{}', '{}', '{}'),
    ('olive', '橄榄', 'Olive', 'fruit', '{}', '{}', '{}'),
    ('peach', '桃', 'Peach', 'fruit', ARRAY['桃子']::TEXT[], '{}', '{}'),
    ('pineapple', '菠萝', 'Pineapple', 'fruit', ARRAY['凤梨']::TEXT[], '{}', '{}'),
    ('strawberry', '草莓', 'Strawberry', 'fruit', '{}', '{}', '{}'),
    ('pear', '梨', 'Pear', 'fruit', ARRAY['梨子']::TEXT[], '{}', '{}'),
    ('coconut', '椰子', 'Coconut', 'fruit', '{}', '{}', '{}'),
    ('kiwi', '猕猴桃', 'Kiwi', 'fruit', ARRAY['奇异果']::TEXT[], '{}', '{}'),
    ('papaya', '番木瓜', 'Papaya', 'fruit', ARRAY['木瓜']::TEXT[], '{}', '{}'),
    ('apricot', '杏', 'Apricot', 'fruit', ARRAY['杏子']::TEXT[], '{}', '{}'),
    ('lychee', '荔枝', 'Lychee', 'fruit', '{}', '{}', '{}'),
    ('blueberry', '蓝莓', 'Blueberry', 'fruit', '{}', '{}', '{}'),
    ('mandarin_orange', '橘子', 'Mandarin orange', 'fruit', ARRAY['桔子','柑橘']::TEXT[], '{}', '{}'),
    ('durian', '榴莲', 'Durian', 'fruit', '{}', '{}', '{}'),
    ('pomelo', '柚子', 'Pomelo', 'fruit', '{}', '{}', '{}'),
    ('cherry', '樱桃', 'Cherry', 'fruit', '{}', '{}', '{}'),
    ('cucumber', '黄瓜', 'Cucumber', 'vegetable', '{}', '{}', '{}'),
    ('mushroom', '蘑菇', 'Mushroom', 'vegetable', ARRAY['蕈']::TEXT[], ARRAY['炒菜','调味品']::TEXT[], ARRAY['木耳','银耳','蔬菜']::TEXT[]),
    ('spinach', '菠菜', 'Spinach', 'vegetable', '{}', '{}', '{}'),
    ('pumpkin', '南瓜', 'Pumpkin', 'vegetable', '{}', '{}', '{}'),
    ('broccoli', '西兰花', 'Broccoli', 'vegetable', ARRAY['西蓝花']::TEXT[], '{}', '{}'),
    ('eggplant', '茄子', 'Eggplant', 'vegetable', '{}', '{}', '{}'),
    ('tomato', '西红柿', 'Tomato', 'vegetable', ARRAY['番茄']::TEXT[], ARRAY['调味品','饮料','饼干']::TEXT[], ARRAY['南瓜','胡萝卜','柿子椒']::TEXT[]),
    ('carrot', '胡萝卜', 'Carrot', 'vegetable', '{}', '{}', '{}'),
    ('celery', '芹菜', 'Celery', 'vegetable', '{}', '{}', '{}'),
    ('green_bell_pepper', '青椒', 'Green bell pepper', 'vegetable', '{}', '{}', '{}'),
    ('pea', '豌豆', 'Pea', 'vegetable', '{}', '{}', '{}'),
    ('potato', '土豆', 'Potato', 'vegetable', ARRAY['马铃薯']::TEXT[], '{}', '{}'),
    ('garlic', '大蒜', 'Garlic', 'vegetable', ARRAY['蒜']::TEXT[], '{}', '{}'),
    ('onion', '洋葱', 'Onion', 'vegetable', '{}', '{}', '{}'),
    ('green_soybean', '青豆', 'Green soybean', 'vegetable', ARRAY['青豌豆']::TEXT[], '{}', '{}'),
    ('cauliflower', '菜花', 'Cauliflower', 'vegetable', ARRAY['花椰菜']::TEXT[], '{}', '{}'),
    ('lettuce', '生菜', 'Lettuce', 'vegetable', '{}', '{}', '{}'),
    ('cabbage', '卷心菜', 'Cabbage', 'vegetable', ARRAY['包菜','圆白菜','甘蓝']::TEXT[], '{}', '{}'),
    ('scallion', '大葱', 'Scallion', 'vegetable', ARRAY['葱']::TEXT[], '{}', '{}'),
    ('cilantro', '香菜', 'Cilantro', 'vegetable', ARRAY['芫荽']::TEXT[], '{}', '{}'),
    ('sweet_pepper', '甜椒', 'Sweet pepper', 'vegetable', ARRAY['柿子椒','彩椒']::TEXT[], '{}', '{}'),
    ('asparagus', '芦笋', 'Asparagus', 'vegetable', '{}', '{}', '{}'),
    ('red_radish', '红萝卜', 'Red radish', 'vegetable', '{}', '{}', '{}'),
    ('taro', '芋头', 'Taro', 'vegetable', ARRAY['芋艿']::TEXT[], '{}', '{}'),
    ('napa_cabbage', '白菜', 'Napa cabbage', 'vegetable', ARRAY['大白菜']::TEXT[], '{}', '{}'),
    ('bamboo_shoot', '竹笋', 'Bamboo shoot', 'vegetable', ARRAY['笋']::TEXT[], '{}', '{}'),
    ('red_chili', '红辣椒', 'Red chili', 'vegetable', ARRAY['辣椒']::TEXT[], '{}', '{}'),
    ('parsley', '欧芹', 'Parsley', 'vegetable', '{}', '{}', '{}'),
    ('zucchini', '西葫芦', 'Zucchini', 'vegetable', '{}', '{}', '{}'),
    ('bitter_melon', '苦瓜', 'Bitter melon', 'vegetable', '{}', '{}', '{}'),
    ('chicken', '鸡肉', 'Chicken', 'meat', ARRAY['鸡']::TEXT[], '{}', '{}'),
    ('beef', '牛肉', 'Beef', 'meat', '{}', ARRAY['牛肉干','汉堡','酱料']::TEXT[], ARRAY['猪肉','羊肉','鸡肉','鱼肉']::TEXT[]),
    ('lamb', '羊肉', 'Lamb', 'meat', ARRAY['羊']::TEXT[], '{}', '{}'),
    ('pork', '猪肉', 'Pork', 'meat', ARRAY['猪']::TEXT[], ARRAY['猪肉干','汉堡','酱料']::TEXT[], ARRAY['牛肉','羊肉','鸡肉','鱼肉']::TEXT[]),
    ('clam', '蛤', 'Clam', 'seafood', ARRAY['蛤蜊','花蛤']::TEXT[], '{}', '{}'),
    ('scallop', '扇贝', 'Scallop', 'seafood', '{}', '{}', '{}'),
    ('lobster', '龙虾', 'Lobster', 'seafood', '{}', '{}', '{}'),
    ('oyster', '牡蛎', 'Oyster', 'seafood', ARRAY['生蚝']::TEXT[], '{}', '{}'),
    ('shrimp', '虾', 'Shrimp', 'seafood', ARRAY['对虾','明虾']::TEXT[], ARRAY['虾酱','虾丸','汉堡']::TEXT[], ARRAY['鱼肉','奶制品','坚果']::TEXT[]),
    ('crab', '螃蟹', 'Crab', 'seafood', ARRAY['蟹']::TEXT[], ARRAY['蟹棒','调味品','保健品']::TEXT[], ARRAY['畜禽肉蛋','奶制品','鱼肉']::TEXT[]),
    ('squid', '鱿鱼', 'Squid', 'seafood', '{}', '{}', '{}'),
    ('cod', '鳕鱼', 'Cod', 'seafood', '{}', ARRAY['汉堡','调味品','保健品']::TEXT[], ARRAY['畜禽肉蛋','奶制品','坚果']::TEXT[]),
    ('trout', '鳟鱼', 'Trout', 'seafood', '{}', '{}', '{}'),
    ('tuna', '金枪鱼', 'Tuna', 'seafood', ARRAY['吞拿鱼']::TEXT[], '{}', '{}'),
    ('salmon', '三文鱼', 'Salmon', 'seafood', ARRAY['鲑鱼']::TEXT[], '{}', '{}'),
    ('sardine', '沙丁鱼', 'Sardine', 'seafood', '{}', '{}', '{}'),
    ('grass_carp', '草鱼', 'Grass carp', 'seafood', '{}', '{}', '{}'),
    ('hairtail', '带鱼', 'Hairtail', 'seafood', '{}', '{}', '{}'),
    ('wheat', '小麦', 'Wheat', 'grain_nut', '{}', ARRAY['啤酒','饺子','蛋糕','饼干','调味品']::TEXT[], ARRAY['大米','土豆','红薯','山药']::TEXT[]),
    ('buckwheat', '荞麦', 'Buckwheat', 'grain_nut', '{}', '{}', '{}'),
    ('rice', '大米', 'Rice', 'grain_nut', ARRAY['稻米','白米']::TEXT[], ARRAY['米线','米饼','米酒']::TEXT[], ARRAY['小麦','红薯','高粱','燕麦']::TEXT[]),
    ('corn', '玉米', 'Corn', 'grain_nut', ARRAY['粟米','玉蜀黍']::TEXT[], ARRAY['玉米油','面条','淀粉']::TEXT[], ARRAY['土豆','红薯','小麦','高粱']::TEXT[]),
    ('oat', '燕麦', 'Oat', 'grain_nut', '{}', '{}', '{}'),
    ('soybean', '大豆', 'Soybean', 'grain_nut', ARRAY['黄豆']::TEXT[], ARRAY['豆芽','腐竹','豆浆','豆奶']::TEXT[], ARRAY['奶类','酸奶','动物蛋白']::TEXT[]),
    ('sweet_potato', '甘薯', 'Sweet potato', 'grain_nut', ARRAY['红薯','地瓜','番薯']::TEXT[], '{}', '{}'),
    ('almond', '杏仁', 'Almond', 'grain_nut', '{}', '{}', '{}'),
    ('peanut', '花生', 'Peanut', 'grain_nut', '{}', '{}', '{}'),
    ('cashew', '腰果', 'Cashew', 'grain_nut', '{}', '{}', '{}'),
    ('black_walnut', '黑胡桃', 'Black walnut', 'grain_nut', ARRAY['核桃']::TEXT[], ARRAY['核桃酥等加核桃的甜品']::TEXT[], ARRAY['大米','小米','土豆','红薯','山药']::TEXT[]),
    ('chestnut', '栗子', 'Chestnut', 'grain_nut', ARRAY['板栗']::TEXT[], '{}', '{}'),
    ('hazelnut', '榛子', 'Hazelnut', 'grain_nut', '{}', '{}', '{}'),
    ('sesame', '芝麻', 'Sesame', 'grain_nut', '{}', '{}', '{}'),
    ('soy_milk', '豆浆', 'Soy milk', 'grain_nut', ARRAY['豆奶']::TEXT[], '{}', '{}'),
    ('gluten', '谷蛋白', 'Gluten', 'grain_nut', ARRAY['麸质','面筋']::TEXT[], ARRAY['啤酒','面包','饼干','麦片']::TEXT[], ARRAY['大米','土豆','红薯','山药','荞麦','小米']::TEXT[]),
    ('rye', '黑麦', 'Rye', 'grain_nut', '{}', '{}', '{}'),
    ('barley', '大麦', 'Barley', 'grain_nut', '{}', '{}', '{}'),
    ('millet', '小米', 'Millet', 'grain_nut', ARRAY['粟']::TEXT[], '{}', '{}'),
    ('sunflower_seed', '葵花籽', 'Sunflower seed', 'grain_nut', ARRAY['瓜子']::TEXT[], '{}', '{}'),
    ('malt', '麦芽', 'Malt', 'grain_nut', '{}', '{}', '{}'),
    ('mung_bean', '绿豆', 'Mung bean', 'grain_nut', '{}', '{}', '{}'),
    ('red_kidney_bean', '红芸豆', 'Red kidney bean', 'grain_nut', ARRAY['芸豆']::TEXT[], '{}', '{}'),
    ('egg_white', '鸡蛋白', 'Egg white', 'dairy_egg', ARRAY['蛋白','蛋清']::TEXT[], ARRAY['蛋糕','饼干','面包','蛋挞','糕点']::TEXT[], ARRAY['豆腐','酸奶','牛奶','豆浆']::TEXT[]),
    ('egg_yolk', '鸡蛋黄', 'Egg yolk', 'dairy_egg', ARRAY['蛋黄']::TEXT[], ARRAY['蛋糕','饼干','面包','蛋挞','糕点']::TEXT[], ARRAY['肝脏','奶制品','坚果']::TEXT[]),
    ('goat_milk', '羊奶', 'Goat milk', 'dairy_egg', '{}', '{}', '{}'),
    ('yogurt', '酸奶', 'Yogurt', 'dairy_egg', ARRAY['优格']::TEXT[], '{}', '{}'),
    ('ovomucoid', '卵类粘蛋白', 'Ovomucoid', 'dairy_egg', ARRAY['卵类黏蛋白','卵粘蛋白','卵黏蛋白']::TEXT[], ARRAY['禽蛋制品','冰激凌','双皮奶','甜点']::TEXT[], ARRAY['豆腐','豆浆']::TEXT[]),
    ('buffalo_milk', '水牛牛奶', 'Buffalo milk', 'dairy_egg', ARRAY['水牛奶']::TEXT[], '{}', '{}'),
    ('skim_milk_powder', '脱脂奶粉', 'Skim milk powder', 'dairy_egg', ARRAY['脱脂牛奶']::TEXT[], '{}', '{}'),
    ('boiled_milk', '煮过的牛奶', 'Boiled milk', 'dairy_egg', ARRAY['熟牛奶']::TEXT[], '{}', '{}'),
    ('hydrolyzed_milk_powder', '水解奶粉', 'Hydrolyzed milk powder', 'dairy_egg', ARRAY['水解配方奶']::TEXT[], '{}', '{}'),
    ('alpha_lactalbumin', 'α-乳清蛋白', 'Alpha-lactalbumin', 'dairy_egg', ARRAY['a-乳清蛋白','α乳清蛋白','alpha-乳清蛋白']::TEXT[], ARRAY['牛奶','母乳','冰激凌','面包','曲奇','酸奶']::TEXT[], ARRAY['豆浆','鸡蛋','虾皮']::TEXT[]),
    ('buttermilk', '酪乳', 'Buttermilk', 'dairy_egg', '{}', ARRAY['牛奶','羊奶','奶酪','甜点']::TEXT[], ARRAY['豆浆','鸡蛋','虾皮']::TEXT[]),
    ('cheddar_cheese', '切达干酪', 'Cheddar cheese', 'dairy_egg', ARRAY['车打芝士','切达奶酪']::TEXT[], '{}', '{}'),
    ('cottage_cheese', '白软干酪', 'Cottage cheese', 'dairy_egg', ARRAY['白软奶酪']::TEXT[], '{}', '{}'),
    ('butter', '黄油', 'Butter', 'dairy_egg', ARRAY['牛油']::TEXT[], '{}', '{}'),
    ('chocolate', '巧克力', 'Chocolate', 'other', '{}', '{}', '{}'),
    ('coffee', '咖啡', 'Coffee', 'other', '{}', '{}', '{}'),
    ('black_tea', '红茶', 'Black tea', 'other', '{}', '{}', '{}'),
    ('yeast', '酵母', 'Yeast', 'other', '{}', ARRAY['馒头','酒','面包','蛋糕','烤饼','调味品']::TEXT[], ARRAY['坚果及杂粮']::TEXT[]),
    ('green_tea', '绿茶', 'Green tea', 'other', '{}', '{}', '{}'),
    ('cinnamon', '肉桂', 'Cinnamon', 'other', '{}', '{}', '{}'),
    ('cane_sugar', '蔗糖', 'Cane sugar', 'other', ARRAY['白砂糖']::TEXT[], '{}', '{}'),
    ('honey', '蜂蜜', 'Honey', 'other', '{}', '{}', '{}'),
    ('mustard', '芥末', 'Mustard', 'other', '{}', '{}', '{}'),
    ('mint', '薄荷', 'Mint', 'other', '{}', '{}', '{}')
ON CONFLICT (food_key) DO NOTHING;
