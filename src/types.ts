export interface ValeSettings {
  valePath?: string;
  configPath?: string;
}

export const DEFAULT_SETTINGS: ValeSettings = {
  valePath: "",
  configPath: "",
};

export interface ValeResponse {
  [key: string]: ValeAlert[];
}

// Mirror the Vale JSON output format.
export interface ValeAlert {
  Action: {
    Name: string;
    Params: string[];
  };
  Check: string;
  Description: string;
  Line: number;
  Link: string;
  Message: string;
  Severity: string;
  Span: number[];
  Match: string;
}

export interface CheckInput {
  text: string;
  format: string;
}
