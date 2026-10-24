/**
 * Runs the google-api skill's CLI as the registered read-only consumer
 * runway-sheet-sync and returns its parsed JSON stdout.
 *
 * The CLI holds the OAuth badge; this file never reads a credential or token
 * file, it only invokes the one door. execFile with an argv array, never a
 * shell string, a hard timeout, and an explicit minimal env.
 */
import { execFile } from "child_process";
import { homedir } from "os";
import { join } from "path";

export const GOOGLE_API_CONSUMER = "runway-sheet-sync";
export const DEFAULT_CLI_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const STDERR_TAIL_CHARS = 300;

export class GoogleApiCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleApiCliError";
  }
}

export interface GoogleApiCliOptions {
  /** Overrides RUNWAY_GOOGLE_API_CLI and the default skill path. */
  cliPath?: string;
  timeoutMs?: number;
}

/** RUNWAY_GOOGLE_API_CLI when set, else the installed skill's cli.js. */
export function resolveGoogleApiCli(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.RUNWAY_GOOGLE_API_CLI?.trim();
  return override || join(homedir(), ".claude", "skills", "google-api", "cli.js");
}

/** Only what the CLI needs to find node and its own badge folder. */
function minimalEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (process.env.HOME) env.HOME = process.env.HOME;
  if (process.env.PATH) env.PATH = process.env.PATH;
  return env;
}

function stderrTail(stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) return "";
  return `: ${trimmed.slice(-STDERR_TAIL_CHARS)}`;
}

/**
 * Runs `node <cli> <command> ...args --consumer runway-sheet-sync`.
 * Any non-zero exit, timeout, start failure or non-JSON stdout throws one
 * GoogleApiCliError, so a caller never mistakes a failure for empty data.
 */
export function runGoogleApiCli(
  command: string,
  args: string[],
  opts: GoogleApiCliOptions = {}
): Promise<unknown> {
  const cliPath = opts.cliPath ?? resolveGoogleApiCli();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLI_TIMEOUT_MS;
  const argv = [cliPath, command, ...args, "--consumer", GOOGLE_API_CONSUMER];
  const label = `google-api CLI ${command}`;

  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      argv,
      { timeout: timeoutMs, killSignal: "SIGKILL", env: minimalEnv(), maxBuffer: MAX_STDOUT_BYTES },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string };
          if (e.killed) {
            reject(new GoogleApiCliError(`${label} timed out after ${timeoutMs}ms`));
          } else if (typeof e.code === "number") {
            reject(new GoogleApiCliError(`${label} exited with code ${e.code}${stderrTail(stderr)}`));
          } else {
            reject(new GoogleApiCliError(`${label} could not run ${cliPath}: ${e.code ?? e.message}`));
          }
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new GoogleApiCliError(`${label} printed output that is not JSON`));
        }
      }
    );
  });
}
