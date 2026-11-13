import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/**
 * Photo storage. "local" writes to ./uploads (fine for dev / a single VPS).
 * "s3" works with AWS S3, Cloudflare R2, Backblaze B2, DO Spaces, etc.
 */
const driver = process.env.STORAGE_DRIVER || "local";
const LOCAL_ROOT = path.resolve(process.cwd(), "uploads");

let s3: S3Client | null = null;
function client() {
  if (!s3) {
    s3 = new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
      },
    });
  }
  return s3;
}

function safeLocalPath(key: string) {
  const p = path.resolve(LOCAL_ROOT, key);
  if (!p.startsWith(LOCAL_ROOT + path.sep)) throw new Error("Invalid storage key");
  return p;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  if (driver === "s3") {
    await client().send(
      new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
    return;
  }
  const p = safeLocalPath(key);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, body);
}

export async function getObject(key: string): Promise<Buffer | null> {
  try {
    if (driver === "s3") {
      const res = await client().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    }
    return await fs.readFile(safeLocalPath(key));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  try {
    if (driver === "s3") {
      await client().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    } else {
      await fs.unlink(safeLocalPath(key));
    }
  } catch {
    /* already gone */
  }
}
