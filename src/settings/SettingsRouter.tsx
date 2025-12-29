import ValePlugin from "../main";
import React from "react";
import { ValeSettings } from "../types";
import { GeneralSettings } from "./GeneralSettings";

interface Props {
  plugin: ValePlugin;
}

export const SettingsRouter = ({ plugin }: Props): React.ReactElement => {
  const [settings, setSettings] = React.useState<ValeSettings>(plugin.settings);

  const onSettingsChange = async (settings: ValeSettings) => {
    // Write new changes to disk.
    plugin.settings = settings;
    await plugin.saveSettings();

    setSettings(settings);
  };

  return (
    <GeneralSettings
      settings={settings}
      onSettingsChange={onSettingsChange}
    />
  );
};
