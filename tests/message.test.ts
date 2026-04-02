import { describe, expect, it } from "vitest";
import { Message } from "../src/dns/message.js";

const queryRaw = Buffer.from([
  0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07, 0x65, 0x78, 0x61, 0x6d, 0x70,
  0x6c, 0x65, 0x03, 0x63, 0x6f, 0x6d, 0x00, 0x00, 0x01, 0x00, 0x01,
]);

describe("Message", () => {
  it("parses a basic question", () => {
    const msg = Message.parse(queryRaw);
    expect(msg.id).toBe(0x1234);
    expect(msg.qname).toBe("example.com");
    expect(msg.qtype).toBe(1);
    expect(msg.qclass).toBe(1);
    expect(msg.qdcount).toBe(1);
  });

  it("builds an error response", () => {
    const msg = Message.parse(queryRaw);
    const response = Message.buildErrorResponse(msg, 5);
    const parsed = Message.parse(response);
    expect(parsed.id).toBe(msg.id);
    expect(parsed.qr()).toBe(true);
    expect(parsed.rcode()).toBe(5);
  });
});
