import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startBackgroundUpdateChecks } from "./update-checks.mjs";

describe("background update checks", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("checks after startup and every three minutes without renderer activity", async () => {
    const check = vi.fn(async () => {});
    startBackgroundUpdateChecks(check);
    await vi.advanceTimersByTimeAsync(4999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(179999);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(180000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("does not overlap a slow update check or download", async () => {
    let finish;
    const check = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    startBackgroundUpdateChecks(check);
    await vi.advanceTimersByTimeAsync(365000);
    expect(check).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(180000);
    expect(check).toHaveBeenCalledTimes(2);
    finish();
  });

  it("tries again on a later interval after a failed request", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
    startBackgroundUpdateChecks(check);
    await vi.advanceTimersByTimeAsync(185000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("can stop before the first check", async () => {
    const check = vi.fn();
    const stop = startBackgroundUpdateChecks(check);
    stop();
    stop();
    await vi.advanceTimersByTimeAsync(365000);
    expect(check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops polling on shutdown even if a request is still completing", async () => {
    let finish;
    const check = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const stop = startBackgroundUpdateChecks(check);
    await vi.advanceTimersByTimeAsync(5000);
    stop();
    finish();
    await vi.advanceTimersByTimeAsync(360000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
