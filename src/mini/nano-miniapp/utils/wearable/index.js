'use strict'

// Base class for all wearable device adapters.
// Each brand implements these methods using its own protocol.
class WearableDevice {
  // → { level: 0-100, charging: boolean }
  async getBattery() { throw new Error('not implemented') }

  // → { name, model, firmware, hardware }
  async getDeviceInfo() { throw new Error('not implemented') }

  // → [{ value: number, timestamp: Date }]
  async getHeartRateLog(date) { throw new Error('not implemented') }

  // → { steps, calories, distance }
  async getSteps(date) { throw new Error('not implemented') }

  // → { totalMinutes, deep, light, rem, awake, periods: [{ type, typeName, minutes }] }
  async getSleep() { throw new Error('not implemented') }

  // type: 'heart-rate' | 'spo2' | 'hrv' | 'blood-pressure' | 'pressure' | 'blood-sugar'
  // → number | null
  async getRealtime(type) { throw new Error('not implemented') }

  // Sync the ring clock to the given date (default: now)
  async setTime(date) { throw new Error('not implemented') }

  async connect(deviceId) { throw new Error('not implemented') }
  async disconnect() { throw new Error('not implemented') }
}

// Factory — returns the right adapter for the given brand string.
// brand: 'colmi' | 'halo' | 'aizo' | 'v8'
// 'x3' is accepted as a legacy alias for 'halo' — existing local storage /
// server rows saved before the X3→Halo rename still use 'x3'.
function createWearable(brand) {
  if (brand === 'colmi') {
    const ColmiRing = require('./colmi/index.js')
    return new ColmiRing()
  }
  if (brand === 'halo' || brand === 'x3') {
    const HaloRing = require('./halo/index.js')
    return new HaloRing()
  }
  if (brand === 'aizo') {
    const AizoRing = require('./aizo/index.js')
    return new AizoRing()
  }
  if (brand === 'v8') {
    const V8Band = require('./v8/index.js')
    return new V8Band()
  }
  throw new Error(`Unknown wearable brand: ${brand}`)
}

module.exports = { WearableDevice, createWearable }
