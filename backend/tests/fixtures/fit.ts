import { Encoder, Profile } from "@garmin/fitsdk";

/** Builds small but real FIT files with Garmin's own encoder, for decoder tests. */
const N = Profile.MesgNum as Record<
  | "FILE_ID"
  | "RECORD"
  | "SESSION"
  | "MONITORING"
  | "MONITORING_HR_DATA"
  | "SLEEP_LEVEL"
  | "SLEEP_ASSESSMENT"
  | "HRV_VALUE"
  | "SPO2_DATA",
  number
>;
type Fields = Record<string, unknown>;

function encode(type: string, mesgs: [number, Fields][]): Uint8Array {
  const enc = new Encoder();
  enc.writeMesg({
    mesgNum: N.FILE_ID,
    type,
    manufacturer: "garmin",
    product: 4257,
    timeCreated: new Date("2026-09-20T00:00:00Z"),
    serialNumber: 1234,
  } as never);
  for (const [mesgNum, fields] of mesgs) enc.writeMesg({ mesgNum, ...fields } as never);
  return enc.close();
}

export function activityFit(start = new Date("2026-09-20T22:00:00Z")) {
  const records: [number, Fields][] = Array.from({ length: 30 }, (_, i) => [
    N.RECORD,
    { timestamp: new Date(start.getTime() + i * 1000), heartRate: 120 + i },
  ]);
  return encode("activity", [
    ...records,
    [
      N.SESSION,
      {
        timestamp: new Date(start.getTime() + 1800_000),
        startTime: start,
        sport: "running",
        subSport: "generic",
        totalElapsedTime: 1800,
        totalTimerTime: 1750,
        totalDistance: 5000,
        totalCycles: 2500,
        totalCalories: 400,
        avgHeartRate: 150,
        maxHeartRate: 175,
      },
    ],
  ]);
}

/**
 * Monitoring: a full timestamp, then timestamp16 offsets; cumulative steps per activity type.
 * `cycles` has scale 2 in the profile; its `steps` subfield (scale 1) reads the same raw value,
 * so cycles: 500 decodes as steps: 1000.
 */
export function monitoringFit(base = new Date("2026-09-20T12:00:00Z")) {
  const fitSec = Math.floor(base.getTime() / 1000) - 631_065_600;
  const t16 = (offset: number) => (fitSec + offset) & 0xffff;
  return encode("monitoringB", [
    [N.MONITORING, { timestamp: base, activityType: "walking", cycles: 500, activeCalories: 50 }],
    [N.MONITORING, { timestamp16: t16(60), heartRate: 72 }],
    [N.MONITORING, { timestamp16: t16(120), activityType: "walking", cycles: 550, activeCalories: 55 }],
    [N.MONITORING, { timestamp16: t16(180), activityType: "running", cycles: 150 }],
    [N.MONITORING, { timestamp16: t16(240), activityType: "running", cycles: 225 }],
    [N.MONITORING, { timestamp16: t16(300), heartRate: 10 }], // implausible HR, dropped
    [
      N.MONITORING_HR_DATA,
      { timestamp: new Date(base.getTime() + 3600_000), currentDayRestingHeartRate: 52 },
    ],
  ]);
}

export function sleepFit(start = new Date("2026-09-20T03:00:00Z")) {
  const levels = ["awake", "light", "light", "deep", "rem", "unmeasurable", "light"];
  return encode("device", [
    ...levels.map((sleepLevel, i): [number, Fields] => [
      N.SLEEP_LEVEL,
      { timestamp: new Date(start.getTime() + i * 3600_000), sleepLevel },
    ]),
    [N.SLEEP_ASSESSMENT, { overallSleepScore: 81 }],
    [N.HRV_VALUE, { timestamp: new Date(start.getTime() + 600_000), value: 45 }],
    [N.HRV_VALUE, { timestamp: new Date(start.getTime() + 900_000), value: 50 }],
    [N.SPO2_DATA, { timestamp: new Date(start.getTime() + 60_000), readingSpo2: 95, readingConfidence: 90 }],
  ]);
}
