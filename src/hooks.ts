import { App } from "obsidian";
import * as React from "react";
import { ValeConfigManager } from "./vale/ValeConfigManager";
import { AppContext, SettingsContext } from "./context";
import { ValeSettings } from "./types";
import { ensureAbsolutePath, newManagedConfigManager } from "./utils";

export const useApp = (): App | undefined => {
  return React.useContext(AppContext);
};

export const useSettings = (): ValeSettings | undefined => {
  return React.useContext(SettingsContext);
};

export const useConfigManager = (
  settings?: ValeSettings
): ValeConfigManager | undefined => {
  const app = useApp();

  return React.useMemo(() => {
    if (!settings || settings.type === "server" || !app) {
      return undefined;
    }

    if (settings.cli.managed) {
      return newManagedConfigManager(app.vault);
    }

    return new ValeConfigManager(
      ensureAbsolutePath(settings.cli.valePath || '', app.vault),
      ensureAbsolutePath(settings.cli.configPath || '', app.vault)
    );
  }, [settings, app]);
};
