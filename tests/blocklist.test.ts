import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Blocklist } from "../src/blocklist.js";

describe("Blocklist", () => {
  const tmp: string[] = [];
  afterEach(() => {
    for (const f of tmp) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
    tmp.length = 0;
  });

  it("matches exact and suffix domains and honors allowlist", () => {
    const block = path.join(os.tmpdir(), `bl-${Date.now()}.txt`);
    const allow = path.join(os.tmpdir(), `al-${Date.now()}.txt`);
    tmp.push(block, allow);
    fs.writeFileSync(block, "bad.example\nads.example\n");
    fs.writeFileSync(allow, "safe.bad.example\n");

    const list = new Blocklist(block, allow);
    expect(list.blocked("bad.example")).toBe(true);
    expect(list.blocked("www.bad.example")).toBe(true);
    expect(list.blocked("safe.bad.example")).toBe(false);
    expect(list.blocked("ok.example")).toBe(false);
  });
});
