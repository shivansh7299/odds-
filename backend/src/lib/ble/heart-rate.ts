/**
 * Bluetooth GATT Heart Rate Measurement (characteristic 0x2A37) parser.
 *
 * Byte 0 flags:
 *   bit 0    heart-rate value format: 0 = uint8, 1 = uint16
 *   bits 1-2 sensor contact: 0b10 supported but not detected, 0b11 detected
 *   bit 3    energy expended present (uint16, kJ)
 *   bit 4    RR-intervals present (uint16 each, units of 1/1024 s)
 */
export type HeartRateMeasurement = {
  bpm: number;
  /** null when the sensor doesn't report contact status. */
  contact: boolean | null;
  energyKj: number | null;
  /** Beat-to-beat intervals in milliseconds (often absent on watches). */
  rrMs: number[];
};

export function parseHeartRateMeasurement(view: DataView): HeartRateMeasurement {
  if (view.byteLength < 2) throw new RangeError("Heart rate measurement too short");
  const flags = view.getUint8(0);
  let offset = 1;

  const wide = (flags & 0x01) !== 0;
  if (wide && view.byteLength < 3) throw new RangeError("Truncated uint16 heart rate");
  const bpm = wide ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += wide ? 2 : 1;

  const contactSupported = (flags & 0x04) !== 0;
  const contact = contactSupported ? (flags & 0x02) !== 0 : null;

  let energyKj: number | null = null;
  if (flags & 0x08) {
    if (offset + 2 <= view.byteLength) energyKj = view.getUint16(offset, true);
    offset += 2;
  }

  const rrMs: number[] = [];
  if (flags & 0x10) {
    for (; offset + 2 <= view.byteLength; offset += 2) {
      rrMs.push(Math.round((view.getUint16(offset, true) / 1024) * 1000));
    }
  }
  return { bpm, contact, energyKj, rrMs };
}
