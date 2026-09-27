import { describe, expect, it } from "vitest";
import { parseHeartRateMeasurement } from "@/lib/ble/heart-rate";

const view = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe("parseHeartRateMeasurement", () => {
  it("parses a uint8 heart rate with no extras", () => {
    expect(parseHeartRateMeasurement(view(0x00, 72))).toEqual({
      bpm: 72,
      contact: null,
      energyKj: null,
      rrMs: [],
    });
  });

  it("parses a uint16 heart rate (little-endian)", () => {
    expect(parseHeartRateMeasurement(view(0x01, 0x2c, 0x01)).bpm).toBe(300);
  });

  it("reads sensor contact status", () => {
    expect(parseHeartRateMeasurement(view(0x06, 60)).contact).toBe(true); // supported + detected
    expect(parseHeartRateMeasurement(view(0x04, 60)).contact).toBe(false); // supported, not detected
  });

  it("skips energy expended and converts RR intervals from 1/1024 s to ms", () => {
    // flags: RR + energy; bpm 65; energy 0x0102; RR 1024 (=1000 ms), 820 (≈801 ms)
    const m = parseHeartRateMeasurement(view(0x18, 65, 0x02, 0x01, 0x00, 0x04, 0x34, 0x03));
    expect(m).toEqual({ bpm: 65, contact: null, energyKj: 258, rrMs: [1000, 801] });
  });

  it("parses RR intervals with a uint16 heart rate", () => {
    expect(parseHeartRateMeasurement(view(0x11, 80, 0x00, 0x00, 0x03)).rrMs).toEqual([750]);
  });

  it("ignores a dangling odd byte in the RR block", () => {
    expect(parseHeartRateMeasurement(view(0x10, 70, 0x00, 0x04, 0x01)).rrMs).toEqual([1000]);
  });

  it("rejects truncated packets", () => {
    expect(() => parseHeartRateMeasurement(view(0x00))).toThrow();
    expect(() => parseHeartRateMeasurement(view(0x01, 0x10))).toThrow();
  });
});
