export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

export interface Question {
  name: string;
  qtype: number;
  qclass: number;
}

export class Message {
  readonly raw: Buffer;
  readonly id: number;
  readonly flags: number;
  readonly qdcount: number;
  readonly ancount: number;
  readonly nscount: number;
  readonly arcount: number;
  readonly questions: Question[];
  readonly questionBytes: Buffer;

  private constructor(params: {
    raw: Buffer;
    id: number;
    flags: number;
    qdcount: number;
    ancount: number;
    nscount: number;
    arcount: number;
    questions: Question[];
    questionBytes: Buffer;
  }) {
    this.raw = params.raw;
    this.id = params.id;
    this.flags = params.flags;
    this.qdcount = params.qdcount;
    this.ancount = params.ancount;
    this.nscount = params.nscount;
    this.arcount = params.arcount;
    this.questions = params.questions;
    this.questionBytes = params.questionBytes;
  }

  static parse(raw: Buffer): Message {
    if (raw.length < 12) throw new ParseError("dns header too short");

    const id = raw.readUInt16BE(0);
    const flags = raw.readUInt16BE(2);
    const qdcount = raw.readUInt16BE(4);
    const ancount = raw.readUInt16BE(6);
    const nscount = raw.readUInt16BE(8);
    const arcount = raw.readUInt16BE(10);

    let offset = 12;
    const questions: Question[] = [];
    for (let i = 0; i < qdcount; i++) {
      const nameResult = Message.readName(raw, offset);
      offset = nameResult.nextOffset;
      if (raw.length < offset + 4) throw new ParseError("truncated question");
      const qtype = raw.readUInt16BE(offset);
      const qclass = raw.readUInt16BE(offset + 2);
      offset += 4;
      questions.push({ name: nameResult.name, qtype, qclass });
    }

    const questionBytes = raw.subarray(12, offset);

    return new Message({
      raw,
      id,
      flags,
      qdcount,
      ancount,
      nscount,
      arcount,
      questions,
      questionBytes,
    });
  }

  get question(): Question | undefined {
    return this.questions[0];
  }

  qr(): boolean {
    return (this.flags & 0x8000) !== 0;
  }

  opcode(): number {
    return (this.flags & 0x7800) >> 11;
  }

  rd(): boolean {
    return (this.flags & 0x0100) !== 0;
  }

  cd(): boolean {
    return (this.flags & 0x0010) !== 0;
  }

  rcode(): number {
    return this.flags & 0x000f;
  }

  get qname(): string | undefined {
    return this.question?.name;
  }

  get qtype(): number | undefined {
    return this.question?.qtype;
  }

  get qclass(): number | undefined {
    return this.question?.qclass;
  }

  cacheKey(): string {
    const q = this.question;
    const name = (q?.name ?? "").toLowerCase();
    return `${name}|${q?.qtype ?? 0}|${q?.qclass ?? 0}`;
  }

  cacheTtlSeconds(negativeTtlSeconds: number): number {
    const ttls = Message.extractTtls(this.raw);
    const rc = this.rcode();

    if (rc === 3) {
      if (ttls.length === 0) return negativeTtlSeconds;
      return Math.min(...ttls);
    }

    if (rc !== 0) return 0;
    if (ttls.length === 0) return 0;
    return Math.min(...ttls);
  }

  static readName(
    data: Buffer,
    offset: number,
    depth = 0,
  ): { name: string; nextOffset: number } {
    if (depth > 20) throw new ParseError("name compression loop");
    if (offset >= data.length) throw new ParseError("name offset out of bounds");

    const labels: string[] = [];

    for (;;) {
      if (offset >= data.length) throw new ParseError("truncated name");
      const length = data[offset];
      offset += 1;

      if ((length & 0xc0) === 0xc0) {
        if (offset >= data.length) throw new ParseError("truncated compression pointer");
        const pointer = ((length & 0x3f) << 8) | data[offset];
        offset += 1;
        const pointed = Message.readName(data, pointer, depth + 1);
        if (pointed.name) labels.push(pointed.name);
        break;
      } else if (length === 0) {
        break;
      } else {
        if (data.length < offset + length) throw new ParseError("truncated label");
        labels.push(data.subarray(offset, offset + length).toString("binary"));
        offset += length;
      }
    }

    return { name: labels.filter(Boolean).join("."), nextOffset: offset };
  }

  static skipName(data: Buffer, offset: number): number {
    return Message.readName(data, offset).nextOffset;
  }

  static extractTtls(raw: Buffer): number[] {
    try {
      if (raw.length < 12) return [];
      const qdcount = raw.readUInt16BE(4);
      const ancount = raw.readUInt16BE(6);
      const nscount = raw.readUInt16BE(8);
      const arcount = raw.readUInt16BE(10);
      let offset = 12;
      for (let i = 0; i < qdcount; i++) {
        offset = Message.skipName(raw, offset);
        if (raw.length < offset + 4) throw new ParseError("truncated question rr");
        offset += 4;
      }
      const ttls: number[] = [];
      const total = ancount + nscount + arcount;
      for (let i = 0; i < total; i++) {
        offset = Message.skipName(raw, offset);
        if (raw.length < offset + 10) throw new ParseError("truncated rr");
        const ttl = raw.readUInt32BE(offset + 4);
        const rdlength = raw.readUInt16BE(offset + 8);
        offset += 10;
        if (raw.length < offset + rdlength) throw new ParseError("truncated rdata");
        ttls.push(ttl);
        offset += rdlength;
      }
      return ttls;
    } catch (e) {
      if (e instanceof ParseError) return [];
      throw e;
    }
  }

  static responseFlagsFor(query: Message, rcode: number, recursionAvailable = true): number {
    const qr = 0x8000;
    const opcode = query.flags & 0x7800;
    const rd = query.flags & 0x0100;
    const cd = query.flags & 0x0010;
    const ra = recursionAvailable ? 0x0080 : 0;
    return qr | opcode | rd | cd | ra | (rcode & 0x000f);
  }

  static buildErrorResponse(query: Message, rcode: number, recursionAvailable = true): Buffer {
    const flags = Message.responseFlagsFor(query, rcode, recursionAvailable);
    const header = Buffer.alloc(12);
    header.writeUInt16BE(query.id, 0);
    header.writeUInt16BE(flags, 2);
    header.writeUInt16BE(query.qdcount, 4);
    header.writeUInt16BE(0, 6);
    header.writeUInt16BE(0, 8);
    header.writeUInt16BE(0, 10);
    return Buffer.concat([header, query.questionBytes]);
  }
}
