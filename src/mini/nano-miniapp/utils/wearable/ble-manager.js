'use strict'

// WeChat BLE abstraction layer.
// Converts the wx.* callback-based BLE APIs into async/promise form
// and handles multi-packet response assembly for Colmi ring protocol.

class BLEManager {
  constructor() {
    this._connectedDeviceId = null
    this._notifyHandlers = {}  // normalizedUUID → fn(Uint8Array)
    this._serviceUUIDs = {}    // normalizedUUID → actual WeChat-format UUID
    this._charUUIDs = {}       // normalizedUUID → actual WeChat-format UUID
    this._valueChangeListenerAttached = false
  }

  // Initialize the Bluetooth adapter. Must be called before scanning/connecting.
  openAdapter() {
    return new Promise((resolve, reject) => {
      wx.openBluetoothAdapter({
        success: resolve,
        fail: (err) => {
          // "already opened" means the adapter is already usable (e.g. a prior
          // BLEManager instance opened it, like handleBindWearable's own scan
          // phase does before handing off to ring.connect()'s separate
          // BLEManager) — not a real failure, so don't fail the whole flow.
          if ((err.errMsg || '').includes('already opened')) {
            resolve(err)
          } else {
            reject(new Error(err.errMsg || 'openBluetoothAdapter failed'))
          }
        },
      })
    })
  }

  closeAdapter() {
    return new Promise((resolve) => {
      wx.closeBluetoothAdapter({ complete: resolve })
    })
  }

  // Scan for nearby BLE devices. Returns [{ deviceId, name, rssi }].
  // nameFilter: string or array of strings — devices whose name starts with any prefix are kept.
  //   Pass null to return all devices (use services filter instead).
  // services: array of service UUIDs to filter by advertisement (passed to wx API).
  scan(nameFilter, timeoutMs = 8000, services = []) {
    return new Promise((resolve, reject) => {
      const found = new Map()
      const prefixes = nameFilter
        ? (Array.isArray(nameFilter) ? nameFilter : [nameFilter])
        : null

      wx.onBluetoothDeviceFound((res) => {
        for (const d of res.devices) {
          const name = d.name || d.localName || ''
          if (!name && !services.length) continue
          if (prefixes && !prefixes.some((p) => name.toLowerCase().startsWith(p.toLowerCase()))) continue
          found.set(d.deviceId, { deviceId: d.deviceId, name: name, rssi: d.RSSI })
        }
      })

      wx.startBluetoothDevicesDiscovery({
        services,
        allowDuplicatesKey: false,
        success: () => {
          setTimeout(() => {
            wx.stopBluetoothDevicesDiscovery({})
            wx.offBluetoothDeviceFound()
            resolve(Array.from(found.values()))
          }, timeoutMs)
        },
        fail: (err) => reject(new Error(err.errMsg || 'startBluetoothDevicesDiscovery failed')),
      })
    })
  }

  // Connect to a device by deviceId and set up characteristic notifications.
  // serviceUUIDs: array of service UUIDs to subscribe notifications on (TX characteristics).
  // notifyMap: { serviceUUID: { txCharUUID, rxCharUUID } }
  async connect(deviceId, notifyMap) {
    this._connectedDeviceId = deviceId

    await new Promise((resolve, reject) => {
      wx.createBLEConnection({
        deviceId,
        success: resolve,
        fail: (err) => reject(new Error(err.errMsg || 'createBLEConnection failed')),
      })
    })

    // Delay after connection before discovering services — R10 needs ~800ms
    await _delay(800)

    const services = await new Promise((resolve, reject) => {
      wx.getBLEDeviceServices({
        deviceId,
        success: (res) => resolve(res.services),
        fail: (err) => reject(new Error(err.errMsg || 'getBLEDeviceServices failed')),
      })
    })

    // Store actual WeChat-format service UUIDs for use in write()
    for (const svc of services) {
      this._serviceUUIDs[_normalizeUUID(svc.uuid)] = svc.uuid
    }

    this._attachValueChangeListener()

    for (const [serviceUUID, { txCharUUID }] of Object.entries(notifyMap)) {
      const svc = services.find((s) => _normalizeUUID(s.uuid) === _normalizeUUID(serviceUUID))
      if (!svc) continue

      const chars = await new Promise((resolve, reject) => {
        wx.getBLEDeviceCharacteristics({
          deviceId,
          serviceId: svc.uuid,
          success: (res) => resolve(res.characteristics),
          fail: (err) => reject(new Error(err.errMsg || 'getBLEDeviceCharacteristics failed')),
        })
      })

      // Store actual WeChat-format char UUIDs for use in write()
      for (const c of chars) {
        this._charUUIDs[_normalizeUUID(c.uuid)] = c.uuid
      }

      const txChar = chars.find((c) => _normalizeUUID(c.uuid) === _normalizeUUID(txCharUUID))
      if (!txChar) continue

      await new Promise((resolve, reject) => {
        wx.notifyBLECharacteristicValueChange({
          deviceId,
          serviceId: svc.uuid,
          characteristicId: txChar.uuid,
          state: true,
          success: resolve,
          fail: (err) => reject(new Error(err.errMsg || 'notifyBLECharacteristicValueChange failed')),
        })
      })
    }
  }

  disconnect() {
    const deviceId = this._connectedDeviceId
    this._connectedDeviceId = null
    this._notifyHandlers = {}
    this._serviceUUIDs = {}
    this._charUUIDs = {}
    if (!deviceId) return Promise.resolve()
    return new Promise((resolve) => {
      wx.closeBLEConnection({ deviceId, complete: resolve })
    })
  }

  // Register a notification handler for a characteristic UUID.
  onNotify(charUUID, fn) {
    this._notifyHandlers[_normalizeUUID(charUUID)] = fn
  }

  // Write a Uint8Array packet to a characteristic.
  // Resolves protocol-format UUIDs to the actual WeChat-discovered format first.
  write(deviceId, serviceUUID, charUUID, packet) {
    const actualSvc  = this._serviceUUIDs[_normalizeUUID(serviceUUID)]  || serviceUUID
    const actualChar = this._charUUIDs[_normalizeUUID(charUUID)]        || charUUID
    return new Promise((resolve, reject) => {
      wx.writeBLECharacteristicValue({
        deviceId,
        serviceId: actualSvc,
        characteristicId: actualChar,
        value: packet.buffer,
        success: resolve,
        fail: (err) => reject(new Error(err.errMsg || 'writeBLECharacteristicValue failed')),
      })
    })
  }

  // Send a packet and collect responses until `isDone(buffer)` returns true.
  // For regular Colmi packets: isDone checks the end subType byte.
  // For Big Data packets: isDone checks accumulated length vs. expected.
  sendAndReceive(deviceId, serviceUUID, charUUID, txCharUUID, packet, isDone, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let totalLen = 0

      const timer = setTimeout(() => {
        this.onNotify(txCharUUID, null)
        reject(new Error('sendAndReceive timed out'))
      }, timeoutMs)

      this.onNotify(txCharUUID, (data) => {
        chunks.push(data)
        totalLen += data.length
        const combined = _concat(chunks, totalLen)
        if (isDone(combined)) {
          clearTimeout(timer)
          this.onNotify(txCharUUID, null)
          resolve(combined)
        }
      })

      this.write(deviceId, serviceUUID, charUUID, packet).catch((err) => {
        clearTimeout(timer)
        this.onNotify(txCharUUID, null)
        reject(err)
      })
    })
  }

  _attachValueChangeListener() {
    if (this._valueChangeListenerAttached) return
    this._valueChangeListenerAttached = true
    wx.onBLECharacteristicValueChange((res) => {
      const normUUID = _normalizeUUID(res.characteristicId)
      const handler = this._notifyHandlers[normUUID]
      if (handler) handler(new Uint8Array(res.value))
    })
  }
}

function _normalizeUUID(uuid) {
  if (!uuid) return ''
  let clean = uuid.replace(/-/g, '').toLowerCase()
  if (clean.length === 4) {
    clean = '0000' + clean + '00001000800000805f9b34fb'
  } else if (clean.length === 8) {
    clean = clean + '00001000800000805f9b34fb'
  }
  return clean
}

function _delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function _concat(arrays, totalLen) {
  const out = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    out.set(arr, offset)
    offset += arr.length
  }
  return out
}

module.exports = { BLEManager }
