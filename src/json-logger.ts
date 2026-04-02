type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function parseLevel(s: string): Level {
  const x = s.toLowerCase();
  if (x === "debug" || x === "info" || x === "warn" || x === "error") return x;
  return "info";
}

export class JsonLogger {
  private readonly min: number;
  private readonly json: boolean;

  constructor(params: { level: string; json: boolean }) {
    this.min = ORDER[parseLevel(params.level)];
    this.json = params.json;
  }

  private emit(level: Level, payload: Record<string, unknown> | string): void {
    if (ORDER[level] < this.min) return;
    const body: Record<string, unknown> =
      typeof payload === "string" ? { message: payload } : { ...(payload as Record<string, unknown>) };
    body.severity ??= level.toUpperCase();
    body.timestamp ??= new Date().toISOString();
    const line = this.json ? JSON.stringify(body) + "\n" : `[${body.timestamp}] ${level} ${JSON.stringify(body)}\n`;
    process.stdout.write(line);
  }

  debug(payload: Record<string, unknown> | string): void {
    this.emit("debug", payload);
  }

  info(payload: Record<string, unknown> | string): void {
    this.emit("info", payload);
  }

  warn(payload: Record<string, unknown> | string): void {
    this.emit("warn", payload);
  }

  error(payload: Record<string, unknown> | string): void {
    this.emit("error", payload);
  }
}
