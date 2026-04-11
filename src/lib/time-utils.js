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

module.exports = {
  getNowShanghai,
  formatToShanghai,
  SHANGHAI_ZONE
};
