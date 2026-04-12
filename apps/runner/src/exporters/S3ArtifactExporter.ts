import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Uploads PNG screenshots to S3/MinIO. The legacy ZIP-of-everything
 * uploader still exists under apps/runner/src/legacy for the
 * backwards-compatible action command; this is the simpler platform-side
 * artifact path.
 */
export class S3ArtifactExporter {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const region = process.env.AWS_REGION ?? "us-east-1";
    const bucket = process.env.S3_BUCKET ?? "insightview-artifacts";
    const endpoint =
      process.env.S3_ENDPOINT ?? process.env.MINIO_ENDPOINT ?? undefined;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: {
        accessKeyId:
          process.env.MINIO_ACCESS_KEY ??
          process.env.MINIO_ROOT_USER ??
          process.env.AWS_ACCESS_KEY_ID ??
          "minioadmin",
        secretAccessKey:
          process.env.MINIO_SECRET_KEY ??
          process.env.MINIO_ROOT_PASSWORD ??
          process.env.AWS_SECRET_ACCESS_KEY ??
          "minioadmin",
      },
    });
  }

  async uploadScreenshot(input: {
    runId: string;
    checkName: string;
    buffer: Buffer;
  }): Promise<string> {
    const key = `synthetic/${input.checkName}/${input.runId}.png`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.buffer,
        ContentType: "image/png",
      }),
    );
    return key;
  }
}
