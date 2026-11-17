import { test } from "node:test";
import assert from "node:assert/strict";
import { isCardValue, nearestFibonacci, summarize } from "./scoring.ts";

test("nearestFibonacci picks the closest card and rounds ties up", () => {
  assert.equal(nearestFibonacci(0.4), 0);
  assert.equal(nearestFibonacci(4), 5);
  assert.equal(nearestFibonacci(6.4), 5);
  assert.equal(nearestFibonacci(6.5), 8);
  assert.equal(nearestFibonacci(17), 21);
  assert.equal(nearestFibonacci(200), 21);
});

test("cards above 21 are not accepted", () => {
  assert.equal(isCardValue("21"), true);
  for (const card of ["34", "55", "89"]) assert.equal(isCardValue(card), false);
});

test("summarize ignores non-numeric cards in the average", () => {
  const summary = summarize(["3", "5", "8", "?", "☕"]);
  assert.equal(summary.average, 16 / 3);
  assert.equal(summary.nearest, 5);
  assert.equal(summary.numericVotes, 3);
  assert.equal(summary.totalVotes, 5);
  assert.deepEqual(summary.distribution, [
    { value: "3", count: 1 },
    { value: "5", count: 1 },
    { value: "8", count: 1 },
    { value: "?", count: 1 },
    { value: "☕", count: 1 },
  ]);
});

test("summarize with no numeric votes has no result", () => {
  const summary = summarize(["?"]);
  assert.equal(summary.average, null);
  assert.equal(summary.nearest, null);
});
