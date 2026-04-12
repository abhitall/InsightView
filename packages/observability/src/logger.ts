import pino, { type Logger, type LoggerOptions } from "pino";

export interface CreateLoggerOptions {
  service: string;
  level?: string;
}

export function createLogger(opts: CreateLoggerOptions): Logger {
  const baseOptions: LoggerOptions = {
    name: opts.service,
    level: opts.level ?? process.env.LOG_LEVEL ?? "info",
    base: {
      service: opts.service,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  return pino(baseOptions);
}

export type { Logger };
