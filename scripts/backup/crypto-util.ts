import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function computeBufferSha256(data: Buffer | Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", (error) => reject(error));
  });
}

export function formatSha256Sums(
  entries: Array<{ filename: string; sha256: string }>,
): string {
  return entries
    .map(({ sha256, filename }) => `${sha256}  ${filename}`)
    .join("\n") + "\n";
}

export function parseSha256Sums(
  content: string,
): Array<{ filename: string; sha256: string }> {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
      if (!match) {
        throw new Error(`Invalid SHA256SUMS line: "${line}"`);
      }
      return {
        sha256: match[1].toLowerCase(),
        filename: match[2].trim(),
      };
    });
}
