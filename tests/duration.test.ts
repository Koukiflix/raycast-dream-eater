import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DurationError,
  EMPTY_DURATION,
  formatDuration,
  MAX_DURATION_SECONDS,
  parseDuration,
  secondsRemaining,
} from "../src/duration";

test("blank fields mean until disabled", () => {
  assert.equal(parseDuration(EMPTY_DURATION), null);
  assert.equal(parseDuration({ hours: " ", minutes: "", seconds: "\t" }), null);
});

test("inline timed command requires a positive duration and gives no indefinite hint", () => {
  assert.throws(() => parseDuration(EMPTY_DURATION, false), /Enter a duration; use Toggle for 1 hour$/);
  assert.throws(() => parseDuration({ ...EMPTY_DURATION, seconds: "0" }, false), /Enter at least 1 second$/);
  assert.equal(parseDuration({ ...EMPTY_DURATION, seconds: "5" }, false), 5);
});

test("hours, minutes and seconds combine exactly", () => {
  assert.equal(parseDuration({ hours: "1", minutes: "2", seconds: "3" }), 3723);
  assert.equal(parseDuration({ hours: "", minutes: "90", seconds: "" }), 5400);
  assert.equal(parseDuration({ hours: "000", minutes: " 0 ", seconds: "1" }), 1);
});

test("explicit zero cannot accidentally start an indefinite session", () => {
  assert.throws(() => parseDuration({ ...EMPTY_DURATION, seconds: "0" }), DurationError);
});

for (const bad of ["-1", "1.5", "1e3", "Infinity", "NaN", "+2", "0x10", "1 0", "1; exit", "abc"]) {
  test(`rejects invalid duration ${JSON.stringify(bad)}`, () => {
    assert.throws(() => parseDuration({ ...EMPTY_DURATION, minutes: bad }), DurationError);
  });
}

test("caps total duration and rejects integer overflow", () => {
  assert.equal(parseDuration({ ...EMPTY_DURATION, seconds: String(MAX_DURATION_SECONDS) }), MAX_DURATION_SECONDS);
  assert.throws(() => parseDuration({ ...EMPTY_DURATION, seconds: String(MAX_DURATION_SECONDS + 1) }), DurationError);
  assert.throws(() => parseDuration({ ...EMPTY_DURATION, hours: "99999999999999999" }), DurationError);
});

test("duration formatting and wall-clock countdown", () => {
  assert.equal(formatDuration(3723), "1h 2m 3s");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(-4), "0s");
  assert.equal(secondsRemaining(5000, 1001), 4);
  assert.equal(secondsRemaining(5000, 6000), 0);
  assert.equal(secondsRemaining(5000, 0), 5);
});
