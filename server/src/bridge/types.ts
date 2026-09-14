/*
 * Shapes shared by the Node client and the ExtendScript panel.
 * The panel writes exactly these JSON objects; keep the two sides in step.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface BridgeCommandFile {
  /** Short random identifier, unique per call. Results are matched on it. */
  id: string;
  /** camelCase bridge command name, for example "createComposition". */
  command: string;
  args: Record<string, unknown>;
  /** ISO timestamp from the server clock. */
  createdAt: string;
  status: 'pending';
  /** Bridge protocol version. The panel refuses commands from a different major version. */
  protocol: number;
}

export interface BridgeErrorInfo {
  message: string;
  /** Machine-readable code, for example "not-found", "invalid-argument", "unsupported", "script-error". */
  code: string;
  command: string;
  id: string;
  line?: number;
  fileName?: string;
  /** Optional structured details, for example the list of available compositions. */
  details?: JsonValue;
}

export interface BridgeResultFile {
  id: string;
  command: string;
  status: 'ok' | 'error';
  result?: JsonValue;
  error?: BridgeErrorInfo;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  aeVersion: string;
  bridgeVersion: string;
}

export interface BridgeHeartbeat {
  at: string;
  aeVersion: string;
  bridgeVersion: string;
  protocol: number;
  pollMs: number;
  queueLength: number;
  busy: boolean;
  commandsRun: number;
  errors: number;
  lastCommand: string | null;
  lastCommandAt: string | null;
  projectName: string | null;
}

export interface BridgeOptionsFile {
  pollMs?: number;
  verbosity?: number;
}

export const BRIDGE_PROTOCOL = 2;

export type BridgeErrorCode =
  | 'timeout'
  | 'bridge-not-running'
  | 'command-failed'
  | 'invalid-result'
  | 'disabled';

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  readonly command: string;
  readonly id: string | undefined;
  readonly details: JsonValue | undefined;
  readonly inner: BridgeErrorInfo | undefined;

  constructor(code: BridgeErrorCode, message: string, opts: { command: string; id?: string; details?: JsonValue; inner?: BridgeErrorInfo }) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
    this.command = opts.command;
    this.id = opts.id;
    this.details = opts.details;
    this.inner = opts.inner;
  }

  toJSON(): Record<string, JsonValue | undefined> {
    return {
      error: this.code,
      message: this.message,
      command: this.command,
      id: this.id,
      details: this.details,
      bridgeError: this.inner ? (this.inner as unknown as JsonValue) : undefined,
    };
  }
}
