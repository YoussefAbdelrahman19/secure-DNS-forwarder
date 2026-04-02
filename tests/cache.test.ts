import { describe, expect, it } from "vitest";
import { Cache } from "../src/cache.js";
import { Message } from "../src/dns/message.js";

const queryRaw = Buffer.from([
  0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x65, 0x78, 0x61, 0x6d, 0x70,
  0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00, 0x00, 0x01, 0x00, 0x01,
]);

const responseRaw = Buffer.from([
  0x12, 0x34, 0x81, 0x80, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x65, 0x78, 0x61, 0x6d, 0x70,
  0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00, 0x00, 0x01, 0x00, 0x01,
]);

describe("Cache", () => {
  it("returns cached response with caller transaction id", () => {
    const cache = new Cache({
      enabled: true,
      maxEntries: 10,
      minTtlSeconds: 1,
      maxTtlSeconds: 60,
      negativeTtlSeconds: 30,
    });
    const query = Message.parse(queryRaw);
    const response = Message.parse(responseRaw);
    cache.write(query, response);

    const alt = Buffer.from(queryRaw);
    alt.writeUInt16BE(0xbeef, 0);
    const anotherQuery = Message.parse(alt);
    const cached = cache.fetch(anotherQuery);
    expect(cached).not.toBeNull();
    expect(cached!.subarray(0, 2).equals(Buffer.from([0xbe, 0xef]))).toBe(true);
  });
});
