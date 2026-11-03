// テスト用の最小の PNG (生成情報を tEXt の parameters に入れられる)。CRC は見ないので 0 のまま

const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
};

export function tinyPng(parameters?: string) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  if (parameters !== undefined) parts.push(chunk("tEXt", Buffer.concat([Buffer.from("parameters\0", "latin1"), Buffer.from(parameters, "latin1")])));
  parts.push(chunk("IDAT", Buffer.alloc(1)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}
