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
// brand: 'colmi'  (add more as new devices are supported)
function createWearable(brand) {
  if (brand === 'colmi') {
    const ColmiRing = require('./colmi/index.js')
    return new ColmiRing()
  }
  throw new Error(`Unknown wearable brand: ${brand}`)
}

module.exports = { WearableDevice, createWearable }
