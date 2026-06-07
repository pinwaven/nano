# Big Data

```
Service: de5bf728-d711-4e47-af26-65e3012a5dc7
Write Characteristic (Requests): de5bf72a-d711-4e47-af26-65e3012a5dc7
Notify Characteristic (Responses): de5bf729-d711-4e47-af26-65e3012a5dc7
```

This is a newer protocol compared to Commands.

These will contain the following structure:

```c
struct BigDataResponse {
    uint8_t bigDataMagic = 188;
    uint8_t dataId;
    uint16_t dataLen;
    uint16_t crc16;
    // Variable data length
}
```

For requests, the variable data will be empty, so set `dataLen` to 0 and `crc16` to UINT16_MAX.

```c
struct BigDataRequest {
    uint8_t bigDataMagic = 188;
    uint8_t dataId;
    uint16_t dataLen = 0;
    uint16_t crc16 = 0xFFFF;
}
```

TODO: There's more Big Data types

## Sleep

ID: 39

```c
struct SleepData {
    uint8_t bigDataMagic = 188;
    uint8_t sleepId = 39;
    uint16_t dataLen;
    uint16_t crc16;
    uint8_t sleepDays;
    SleepDay days[];
}
```

```c
struct SleepDay {
    uint8_t daysAgo;
    uint8_t curDayBytes;
    int16_t sleepStart; // Minutes after midnight
    int16_t sleepEnd; // Minutes after midnight
    SleepPeriod sleepPeriods[];
}

struct SleepPeriod {
    SleepType type;
    uint8_t minutes;
}

enum SleepType : uint8_t {
    NODATA = 0,
    ERROR = 1,
    LIGHT = 2,
    DEEP = 3,
    REM   = 4,
    AWAKE = 5,
}
```

**Note on `NODATA` (0):** The ring emits `NODATA` periods when it loses signal or cannot classify a sleep stage — typically when the user is awake and still (e.g. lying in bed not yet asleep, or awake in the middle of the night). In practice these periods should be treated as **AWAKE**: the ring records the elapsed time but cannot assign a sleep stage. Parsers must map `NODATA → AWAKE` rather than discarding these periods; dropping them causes the stage timeline to not account for significant awake windows and makes `totalMinutes` inconsistent with the `sleepStart`/`sleepEnd` window.

Example from a real R02 capture: a `NODATA, 178` entry (178 minutes) appeared between two sleep blocks, matching a 03:36–06:34 awake gap that would otherwise be invisible.

## Blood Oxygen

ID: 42

```c
struct BloodOxygenData {
    uint8_t bigDataMagic = 188;
    uint8_t sleepId = 42;
    uint16_t dataLen;
    uint16_t crc16;
    uint8_t unk;
    uint8_t daysAgo;
    BloodOxygenSample samples[];
}

struct BloodOxygenSample {
    uint8_t min;
    uint8_t max;
}
```
