import { execFile } from 'child_process';

export interface ValeIssue {
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
  Span: [number, number];
  Match: string;
}

interface ValeOutput {
  [filename: string]: ValeIssue[];
}

export interface ValeRunOptions {
  valePath: string;
  configPath?: string;
  content: string;
  logicalPath: string;
  cwd?: string;
}

interface ProcessResult {
  stdout: string;
  stderr: string;
}

export type ValeProcessRunner = (
  executable: string,
  args: string[],
  options: { cwd?: string },
  input: string
) => Promise<ProcessResult>;

export function buildValeArgs(configPath: string | undefined, logicalPath: string): string[] {
  const args = ['--output=JSON'];
  if (configPath) {
    args.push(`--config=${configPath}`);
  }
  args.push(`--path=${logicalPath}`);
  return args;
}

export function parseValeOutput(stdout: string): ValeIssue[] {
  const output = JSON.parse(stdout || '{}') as ValeOutput;
  const filename = Object.keys(output)[0];
  return filename ? output[filename] ?? [] : [];
}

const executeVale: ValeProcessRunner = (executable, args, options, input) => new Promise((resolve, reject) => {
  const child = execFile(
    executable,
    args,
    { ...options, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    (error, stdout, stderr) => {
      const result = { stdout, stderr };
      if (error) {
        Object.assign(error, result);
        reject(error);
        return;
      }
      resolve(result);
    }
  );

  child.stdin?.end(input);
});

export async function runValeOnText(
  options: ValeRunOptions,
  runner: ValeProcessRunner = executeVale
): Promise<ValeIssue[]> {
  const args = buildValeArgs(options.configPath, options.logicalPath);

  try {
    const { stdout, stderr } = await runner(
      options.valePath,
      args,
      { cwd: options.cwd },
      options.content
    );

    if (stderr && !stderr.includes('warning')) {
      throw new Error(stderr);
    }
    return parseValeOutput(stdout);
  } catch (error) {
    // Vale exits with status 1 when it finds alerts. Its stdout is still the
    // successful JSON result in that case.
    const processError = error as { stdout?: string };
    if (processError.stdout) {
      return parseValeOutput(processError.stdout);
    }
    throw error;
  }
}
