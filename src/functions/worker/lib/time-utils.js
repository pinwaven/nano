const { DateTime } = require('luxon');

const SHANGHAI_ZONE = 'Asia/Shanghai';

/**
 * Returns the current time in Shanghai
 */
const getNowShanghai = () => {
  return DateTime.now().setZone(SHANGHAI_ZONE);
};

/**
 * Formats a date to Shanghai string
 */
const formatToShanghai = (date) => {
  return DateTime.fromJSDate(date).setZone(SHANGHAI_ZONE).toFormat('yyyy-MM-dd HH:mm:ss');
};

/**
 * Calculates age based on birth date
 */
const calculateAge = (birthDate) => {
  if (!birthDate) return 30; // Default to 30 if unknown
  const birth = DateTime.fromJSDate(new Date(birthDate));
  const now = DateTime.now();
  return Math.floor(now.diff(birth, 'years').years);
};

module.exports = {
  getNowShanghai,
  formatToShanghai,
  calculateAge,
  SHANGHAI_ZONE
};
