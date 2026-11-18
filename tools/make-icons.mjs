import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// 아이콘 PNG는 바이너리라 저장소에 넣지 않는다. CI·배포 빌드가 이 스크립트로 web/assets/icons/에 만들고,
// 테스트는 makeIcons()로 임시 폴더에 만들어 확인한다.
const defaultDir = new URL("../web/assets/icons/", import.meta.url);

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) * 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(payload));
  return Buffer.concat([length, payload, checksum]);
}

// 기하학적 A 문양을 직접 그린다. 캐릭터나 외부 그림을 사용하지 않는다.
export function makeIcons(outDir = defaultDir) {
  const dir = outDir instanceof URL ? outDir : pathToFileURL(outDir.endsWith("/") || outDir.endsWith("\\") ? outDir : outDir + "/");
  mkdirSync(dir, { recursive: true });
  const written = {};
  for (const size of [192, 512]) {
    const stride = size * 3 + 1;
    const pixels = Buffer.alloc(stride * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = x / size;
        const ny = y / size;
        const leg = ny > 0.22 && ny < 0.78 && Math.abs(Math.abs(nx - 0.5) - (ny - 0.2) * 0.42) < 0.045;
        const bar = ny > 0.57 && ny < 0.64 && nx > 0.34 && nx < 0.66;
        const color = leg || bar ? [255, 209, 0] : [10, 37, 64];
        const offset = y * stride + 1 + x * 3;
        pixels.set(color, offset);
      }
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(size, 0);
    header.writeUInt32BE(size, 4);
    header[8] = 8;
    header[9] = 2;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
    ]);
    const file = new URL(`icon-${size}.png`, dir);
    writeFileSync(file, png);
    written[size] = file;
  }
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) makeIcons();
