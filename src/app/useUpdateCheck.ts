import { useEffect } from "react";
import { APP_VERSION } from "../config/settings.js";
import {
  checkForUpdates,
  isCacheForRunningVersion,
  loadUpdateCheckCache,
  saveUpdateCheckCache,
  type UpdateCheckResult,
} from "../core/version/updateCheck.js";

interface UseUpdateCheckContext {
  startupUpdateEnabled: React.RefObject<boolean>;
  setUpdateCheckResult: React.Dispatch<React.SetStateAction<UpdateCheckResult | null>>;
  returnFromUpdateOverlay: () => void;
  initialUpdateCheckResult: React.RefObject<UpdateCheckResult | null>;
}

export function useUpdateCheck(context: UseUpdateCheckContext) {
  const {
    startupUpdateEnabled,
    setUpdateCheckResult,
    returnFromUpdateOverlay,
    initialUpdateCheckResult,
  } = context;

  // Check npm on every interactive startup before enabling the composer.
  useEffect(() => {
    if (!startupUpdateEnabled.current) return;

    void (async () => {
      const cache = loadUpdateCheckCache();
      try {
        const result = await checkForUpdates({ enabled: true });
        if (result.status === "error") {
          // A previously confirmed update is still useful when npm is briefly
          // unreachable, but it must never suppress the next fresh startup check.
          if (
            cache?.updateAvailable &&
            cache.latestVersion &&
            isCacheForRunningVersion(cache, APP_VERSION)
          ) {
            setUpdateCheckResult({
              status: "update-available",
              currentVersion: cache.currentVersion,
              latestVersion: cache.latestVersion,
              checkedAt: cache.lastChecked,
              source: "cache",
            });
          } else {
            returnFromUpdateOverlay();
          }
          return;
        }

        setUpdateCheckResult(result);
        saveUpdateCheckCache({
          lastChecked: result.checkedAt,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          updateAvailable: result.status === "update-available",
        });
        if (result.status !== "update-available") {
          returnFromUpdateOverlay();
        }
      } catch {
        // Never crash the TUI on a failed update check.
        if (!initialUpdateCheckResult.current) {
          returnFromUpdateOverlay();
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return {};
}
