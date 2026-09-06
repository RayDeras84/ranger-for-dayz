export const UPDATE_STARTUP_DELAY_MS = 5000;
export const UPDATE_CHECK_INTERVAL_MS = 3 * 60 * 1000;

export function startBackgroundUpdateChecks(checkForUpdates) {
  let stopped = false;
  let inFlight = false;
  let interval;

  async function check() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await checkForUpdates();
    } catch {
      // The updater reports errors; keep scheduling checks after a failure.
    } finally {
      inFlight = false;
    }
  }

  const startup = globalThis.setTimeout(() => {
    void check();
    if (stopped) return;
    interval = globalThis.setInterval(check, UPDATE_CHECK_INTERVAL_MS);
    interval.unref?.();
  }, UPDATE_STARTUP_DELAY_MS);
  startup.unref?.();

  return () => {
    stopped = true;
    globalThis.clearTimeout(startup);
    globalThis.clearInterval(interval);
  };
}
