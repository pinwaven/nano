'use strict'

// Colmi ring BLE service and characteristic UUIDs
const UART_SERVICE_UUID      = '6e40fff0b5a3f393e0a9e50e24dcca9e'
const UART_RX_CHAR_UUID      = '6e400002b5a3f393e0a9e50e24dcca9e'  // write
const UART_TX_CHAR_UUID      = '6e400003b5a3f393e0a9e50e24dcca9e'  // notify

const BIG_DATA_SERVICE_UUID  = 'de5bf728d7114e47af2665e3012a5dc7'  // sleep/bulk data
const BIG_DATA_RX_CHAR_UUID  = 'de5bf72ad7114e47af2665e3012a5dc7'
const BIG_DATA_TX_CHAR_UUID  = 'de5bf729d7114e47af2665e3012a5dc7'

// Command bytes
const CMD_BATTERY                = 3
const CMD_SET_TIME               = 1
const CMD_READ_HEART_RATE        = 21   // 0x15
const CMD_HEART_RATE_LOG_SETTINGS = 22  // 0x16
const CMD_GET_STEP_SOMEDAY       = 67   // 0x43
const CMD_START_REAL_TIME        = 105  // 0x69
const CMD_STOP_REAL_TIME         = 106  // 0x6A
const CMD_BIG_DATA               = 188  // 0xBC

// Real-time reading type codes
const RealTimeReading = {
  HEART_RATE:    1,
  BLOOD_PRESSURE: 2,
  SPO2:          3,
  FATIGUE:       4,
  HEALTH_CHECK:  5,
  ECG:           7,
  PRESSURE:      8,
  BLOOD_SUGAR:   9,
  HRV:           10,
}

// Map from user-facing string keys to RealTimeReading codes
const REAL_TIME_MAPPING = {
  'heart-rate':     RealTimeReading.HEART_RATE,
  'blood-pressure': RealTimeReading.BLOOD_PRESSURE,
  'spo2':           RealTimeReading.SPO2,
  'fatigue':        RealTimeReading.FATIGUE,
  'health-check':   RealTimeReading.HEALTH_CHECK,
  'ecg':            RealTimeReading.ECG,
  'pressure':       RealTimeReading.PRESSURE,
  'blood-sugar':    RealTimeReading.BLOOD_SUGAR,
  'hrv':            RealTimeReading.HRV,
}

// Known Colmi ring advertisement name prefixes used for scanning
const COLMI_NAME_PREFIXES = [
  'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R09', 'R10',
  'COLMI', 'VK-5098', 'MERLIN', 'Hello Ring', 'RING1',
  'boAtring', 'TR-R02', 'SE', 'EVOLVEO', 'GL-SR2',
  'Blaupunkt', 'KSIX RING',
]

module.exports = {
  UART_SERVICE_UUID, UART_RX_CHAR_UUID, UART_TX_CHAR_UUID,
  BIG_DATA_SERVICE_UUID, BIG_DATA_RX_CHAR_UUID, BIG_DATA_TX_CHAR_UUID,
  CMD_BATTERY, CMD_SET_TIME, CMD_READ_HEART_RATE,
  CMD_HEART_RATE_LOG_SETTINGS, CMD_GET_STEP_SOMEDAY,
  CMD_START_REAL_TIME, CMD_STOP_REAL_TIME, CMD_BIG_DATA,
  RealTimeReading, REAL_TIME_MAPPING,
  COLMI_NAME_PREFIXES,
}
