import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';

// Zerops object storage: S3-compatible (MinIO backend). forcePathStyle is
// required — MinIO doesn't support virtual-hosted-style addressing.
const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET = process.env.S3_BUCKET || '';

// Uploads the original photo to object storage and returns its key.
// Keeping uploaded images out of the container's local disk is what
// lets the API stay stateless across deploys and multiple containers.
export async function uploadPhoto(buffer: Buffer, mimeType: string): Promise<string> {
  const ext = mimeType.split('/')[1] || 'jpg';
  const key = `photos/${randomUUID()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  return key;
}

// Downloads a previously uploaded photo back out of object storage — used
// to re-run vision on a single flagged item against the original photo
// without asking the user to retake or re-upload anything.
export async function getPhoto(key: string): Promise<Buffer> {
  const result = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const stream = result.Body as AsyncIterable<Uint8Array>;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
