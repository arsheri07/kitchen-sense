import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
