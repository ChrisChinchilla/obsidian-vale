import { Setting } from "obsidian";
import * as React from "react";
import { ValeSettings } from "../types";

interface Props {
  settings: ValeSettings;
  onSettingsChange: (settings: ValeSettings) => void;
}

export const GeneralSettings = ({
  settings,
  onSettingsChange,
}: Props): React.ReactElement => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    (async () => {
      if (ref.current) {
        ref.current.empty();

        new Setting(ref.current)
          .setName("Vale path (optional)")
          .setDesc("Override path to the Vale binary. Leave empty to use 'vale' from system PATH or common installation locations.")
          .addText((text) => {
            const component = text.setValue(settings.valePath || "");

            component.inputEl.onblur = (value) => {
              onSettingsChange({
                ...settings,
                valePath: (value.currentTarget as HTMLInputElement).value,
              });
            };

            return component;
          });

        new Setting(ref.current)
          .setName("Config path (optional)")
          .setDesc("Override Vale's default config discovery. Leave empty to let Vale search for .vale.ini in the current directory and parent directories.")
          .addText((text) => {
            const component = text.setValue(settings.configPath || "");

            component.inputEl.onblur = (value) => {
              onSettingsChange({
                ...settings,
                configPath: (value.currentTarget as HTMLInputElement).value,
              });
            };

            return component;
          });
      }
    })();
  }, [settings]);

  return (
    <>
      <div className="card" style={{ marginBottom: "2rem" }}>
        <small>
          {"If you found this plugin useful, you can "}
          <a href="https://www.buymeacoffee.com/marcusolsson">
            buy me a coffee
          </a>
          {" to support its continued development."}
        </small>
      </div>
      <div ref={ref} />
    </>
  );
};
