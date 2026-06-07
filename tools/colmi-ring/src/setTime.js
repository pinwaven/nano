'use strict';

const { makePacket } = require('./packet');

const CMD_SET_TIME = 1;

function byteToBcd(b) {
  if (b < 0 || b >= 100) throw new Error('byteToBcd input must be 0-99');
  return ((Math.floor(b / 10) << 4) | (b % 10));
}

function setTimePacket(target) {
  const d = new Date(target);
  const data = Buffer.alloc(7);
  data[0] = byteToBcd(d.getFullYear() % 100);
  data[1] = byteToBcd(d.getMonth() + 1);
  data[2] = byteToBcd(d.getDate());
  data[3] = byteToBcd(d.getHours());
  data[4] = byteToBcd(d.getMinutes());
  data[5] = byteToBcd(d.getSeconds());
  data[6] = 1; // English
  return makePacket(CMD_SET_TIME, data);
}

function parseSetTimePacket(packet) {
  const b = packet.slice(1);
  const data = {};
  data.mSupportTemperature = b[0] === 1;
  data.mSupportPlate = b[1] === 1;
  data.mSupportMenstruation = true;
  data.mSupportCustomWallpaper = (b[3] & 1) !== 0;
  data.mSupportBloodOxygen = (b[3] & 2) !== 0;
  data.mSupportBloodPressure = (b[3] & 4) !== 0;
  data.mSupportFeature = (b[3] & 8) !== 0;
  data.mSupportOneKeyCheck = (b[3] & 16) !== 0;
  data.mSupportWeather = (b[3] & 32) !== 0;
  data.mSupportWeChat = (b[3] & 64) === 0;
  data.mSupportAvatar = (b[3] & 128) !== 0;
  data.mNewSleepProtocol = b[8] === 1;
  data.mMaxWatchFace = b[9];
  data.mSupportContact = (b[10] & 1) !== 0;
  data.mSupportLyrics = (b[10] & 2) !== 0;
  data.mSupportAlbum = (b[10] & 4) !== 0;
  data.mSupportGPS = (b[10] & 8) !== 0;
  data.mSupportJieLiMusic = (b[10] & 16) !== 0;
  data.mSupportManualHeart = (b[11] & 1) !== 0;
  data.mSupportECard = (b[11] & 2) !== 0;
  data.mSupportLocation = (b[11] & 4) !== 0;
  data.mMusicSupport = (b[11] & 16) !== 0;
  data.rtkMcu = (b[11] & 32) !== 0;
  data.mEbookSupport = (b[11] & 64) !== 0;
  data.mSupportBloodSugar = (b[11] & 128) !== 0;
  data.mMaxContacts = b[12] === 0 ? 20 : b[12] * 10;
  data.bpSettingSupport = (b[13] & 2) !== 0;
  data.mSupport4G = (b[13] & 4) !== 0;
  data.mSupportNavPicture = (b[13] & 8) !== 0;
  data.mSupportPressure = (b[13] & 16) !== 0;
  data.mSupportHrv = (b[13] & 32) !== 0;
  return data;
}

module.exports = { CMD_SET_TIME, byteToBcd, setTimePacket, parseSetTimePacket };
