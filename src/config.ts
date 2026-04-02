import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export type YamlValue = null | boolean | number | string | YamlValue[] | { [k: string]: YamlValue };

function deepSymbolize(value: YamlValue): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(deepSymbolize);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, deepSymbolize(v)]),
  );
}

export type RecordMap = Record<string, unknown>;

export class AppConfig {
  readonly rootDir: string;
  private readonly data: RecordMap;

  private constructor(data: RecordMap, rootDir: string) {
    this.data = data;
    this.rootDir = rootDir;
  }

  static load(filePath: string): AppConfig {
    const raw = YAML.parse(fs.readFileSync(filePath, "utf8")) as YamlValue;
    const data = deepSymbolize(raw) as RecordMap;
    const resolved = path.resolve(filePath);
    const rootDir = path.resolve(path.dirname(resolved), "..");
    return new AppConfig(data, rootDir);
  }

  get server(): RecordMap {
    return this.data.server as RecordMap;
  }

  get metrics(): RecordMap {
    return this.data.metrics as RecordMap;
  }

  get cache(): RecordMap {
    return this.data.cache as RecordMap;
  }

  get policy(): RecordMap {
    return this.data.policy as RecordMap;
  }

  get upstreams(): RecordMap[] {
    return this.data.upstreams as RecordMap[];
  }

  get logging(): RecordMap {
    return this.data.logging as RecordMap;
  }

  resolvePath(p: string | undefined | null): string | null {
    if (p == null || p === "") return null;
    if (path.isAbsolute(p)) return p;
    return path.resolve(this.rootDir, p);
  }
}
