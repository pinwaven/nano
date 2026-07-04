-- Persists the user's currently-bound wearable ring server-side so every
-- client app built from this codebase (miniapp, and the Android/iOS builds
-- produced via WeChat Donut Multiterminal) can discover the same ring
-- without needing to re-pair on each one.
--
-- Only one ring is tracked per user at a time, mirroring the existing
-- single-device local storage model (wx.getStorageSync('wearable_device')).
-- wearable_mac is the ring's stable hardware MAC (from ring.getMac()), not
-- the BLE deviceId, which is a per-OS/per-scan handle that isn't portable
-- across devices or platforms. Not all ring brands expose a MAC (only Halo,
-- i.e. the X3/X6 hardware family, currently does), so wearable_mac may be
-- NULL even when a ring is bound.
ALTER TABLE users ADD COLUMN IF NOT EXISTS wearable_brand TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wearable_mac TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wearable_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wearable_bound_at TIMESTAMPTZ;
