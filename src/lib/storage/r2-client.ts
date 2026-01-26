import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// R2 uses S3-compatible API
function getR2Endpoint(): string {
  return `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

// Create a new S3 client each time to avoid caching issues in serverless
function createS3Client(): S3Client {
  if (
    !process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY
  ) {
    throw new Error("R2 credentials not configured");
  }

  return new S3Client({
    region: "auto",
    endpoint: getR2Endpoint(),
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

function getBucketName(): string {
  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME not configured");
  }
  return bucket;
}

/**
 * Generate a storage key for an attachment
 * Format: attachments/{workspaceId}/{issueId}/{uuid}_{filename}
 */
export function generateStorageKey(
  workspaceId: string,
  issueId: string,
  filename: string
): string {
  const uuid = crypto.randomUUID();
  // Sanitize filename: remove special characters but keep extension
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `attachments/${workspaceId}/${issueId}/${uuid}_${sanitized}`;
}

/**
 * Generate a presigned URL for uploading a file directly to R2
 * Expires in 15 minutes
 */
export async function generateUploadUrl(
  storageKey: string,
  contentType: string
): Promise<string> {
  const client = createS3Client();
  const bucket = getBucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    ContentType: contentType,
  });

  const url = await getSignedUrl(client, command, { expiresIn: 900 });
  return url;
}

/**
 * Generate a presigned URL for downloading/viewing a file
 * @param storageKey - The key of the object in R2
 * @param expiresIn - Expiration time in seconds (default: 3600 = 1 hour)
 */
export async function generateDownloadUrl(
  storageKey: string,
  expiresIn: number = 3600
): Promise<string> {
  const client = createS3Client();
  const bucket = getBucketName();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: storageKey,
  });

  const url = await getSignedUrl(client, command, { expiresIn });
  return url;
}

/**
 * Delete an object from R2
 */
export async function deleteObject(storageKey: string): Promise<void> {
  const client = createS3Client();
  const bucket = getBucketName();

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: storageKey,
  });

  await client.send(command);
}

/**
 * Upload content directly to R2 (for AI-generated content)
 */
export async function uploadContent(
  storageKey: string,
  content: string,
  contentType: string
): Promise<void> {
  const client = createS3Client();
  const bucket = getBucketName();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: storageKey,
    Body: content,
    ContentType: contentType,
  });

  await client.send(command);
}
