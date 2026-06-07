'use strict'

const { makePacket } = require('../packet.js')
const { CMD_SET_TIME } = require('../protocol.js')

function byteToBcd(b) {
  return ((Math.floor(b / 10) << 4) | (b % 10))
}

function setTimePacket(target) {
  const d = new Date(target)
  const data = [
    byteToBcd(d.getFullYear() % 100),
    byteToBcd(d.getMonth() + 1),
    byteToBcd(d.getDate()),
    byteToBcd(d.getHours()),
    byteToBcd(d.getMinutes()),
    byteToBcd(d.getSeconds()),
    1, // English
  ]
  return makePacket(CMD_SET_TIME, data)
}

// Returns device capability flags from the set-time response packet
function parseSetTimePacket(packet) {
  const b = packet.slice(1)
  return {
    mSupportTemperature:    b[0] === 1,
    mSupportPlate:          b[1] === 1,
    mSupportMenstruation:   true,
    mSupportCustomWallpaper: (b[3] & 1) !== 0,
    mSupportBloodOxygen:    (b[3] & 2) !== 0,
    mSupportBloodPressure:  (b[3] & 4) !== 0,
    mSupportFeature:        (b[3] & 8) !== 0,
    mSupportOneKeyCheck:    (b[3] & 16) !== 0,
    mSupportWeather:        (b[3] & 32) !== 0,
    mSupportWeChat:         (b[3] & 64) === 0,
    mSupportAvatar:         (b[3] & 128) !== 0,
    mNewSleepProtocol:      b[8] === 1,
    mMaxWatchFace:          b[9],
    mSupportContact:        (b[10] & 1) !== 0,
    mSupportLyrics:         (b[10] & 2) !== 0,
    mSupportAlbum:          (b[10] & 4) !== 0,
    mSupportGPS:            (b[10] & 8) !== 0,
    mSupportManualHeart:    (b[11] & 1) !== 0,
    mSupportECard:          (b[11] & 2) !== 0,
    mSupportLocation:       (b[11] & 4) !== 0,
    mMusicSupport:          (b[11] & 16) !== 0,
    rtkMcu:                 (b[11] & 32) !== 0,
    mEbookSupport:          (b[11] & 64) !== 0,
    mSupportBloodSugar:     (b[11] & 128) !== 0,
    mMaxContacts:           b[12] === 0 ? 20 : b[12] * 10,
    bpSettingSupport:       (b[13] & 2) !== 0,
    mSupport4G:             (b[13] & 4) !== 0,
    mSupportNavPicture:     (b[13] & 8) !== 0,
    mSupportPressure:       (b[13] & 16) !== 0,
    mSupportHrv:            (b[13] & 32) !== 0,
  }
}

module.exports = { CMD_SET_TIME, byteToBcd, setTimePacket, parseSetTimePacket }
