export const EXIT = {
  OK: 0,
  CONFLICT: 2,
  DEP_REFUSAL: 3,
  BAD_INPUT: 4,
  HOOK_FAILED: 5,
  STALE_BASE: 6,
  LOCK_TIMEOUT: 7,
  NEEDS_APPROVAL: 8,
  PUSH_RETRIES: 9,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class KawaError extends Error {
  code: number;
  exitCode: ExitCode;
  detail?: Record<string, unknown>;

  constructor(code: number, message: string, exitCode: ExitCode, detail?: Record<string, unknown>) {
    super(message);
    this.name = "KawaError";
    this.code = code;
    this.exitCode = exitCode;
    this.detail = detail;
  }
}

export function badInput(message: string, detail?: Record<string, unknown>): KawaError {
  return new KawaError(4_00, message, EXIT.BAD_INPUT, detail);
}

export function conflict(message: string, detail?: Record<string, unknown>): KawaError {
  return new KawaError(4_02, message, EXIT.CONFLICT, detail);
}

export function depRefusal(message: string, detail?: Record<string, unknown>): KawaError {
  return new KawaError(4_03, message, EXIT.DEP_REFUSAL, detail);
}

export function staleBase(message: string, detail?: Record<string, unknown>): KawaError {
  return new KawaError(4_06, message, EXIT.STALE_BASE, detail);
}

export function lockTimeout(message: string): KawaError {
  return new KawaError(4_07, message, EXIT.LOCK_TIMEOUT);
}

export function needsApproval(message: string, detail?: Record<string, unknown>): KawaError {
  return new KawaError(4_08, message, EXIT.NEEDS_APPROVAL, detail);
}

export function notImplemented(what: string): KawaError {
  return new KawaError(5_01, `${what} is not part of milestone M1`, EXIT.BAD_INPUT);
}
