import { readFileSync, existsSync } from "node:fs";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import type { Exporter } from "./index.js";

/**
 * S3/MinIO artifact exporter. Uploads the JSON envelope plus any
 * screenshots and traces referenced by the steps. Credentials are
 * pulled from standard AWS env vars, with MinIO-style fallbacks
 * preserved for the existing InsightView deployments.
 *
 * When running under GitHub Actions with OIDC, the AWS credentials
 * action (aws-actions/configure-aws-credentials@v4) sets these env
 * vars for us — no static keys required.
 */
export const s3Exporter: Exporter = {
  name: "s3",
  async export(envelope, config) {
    const bucket =
      (config.bucket as string) ??
      process.env.S3_BUCKET ??
      "insightview-synthetic";
    const region =
      (config.region as string) ?? process.env.AWS_REGION ?? "us-east-1";
    const endpoint =
      (config.endpoint as string) ??
      process.env.S3_ENDPOINT ??
      process.env.MINIO_ENDPOINT;
    const forcePathStyle =
      (config.forcePathStyle as boolean | undefined) ??
      process.env.S3_FORCE_PATH_STYLE !== "false";
    const prefix =
      (config.prefix as string) ?? `synthetic/${envelope.monitor}`;

    try {
      const client = new S3Client({
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

      const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
      const baseKey = `${prefix}/${timestamp}-${envelope.runId}`;

      // Upload the JSON envelope.
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${baseKey}/result.json`,
          Body: JSON.stringify(envelope, null, 2),
          ContentType: "application/json",
        }),
      );

      // Upload screenshots and traces.
      for (const step of envelope.steps) {
        if (step.screenshotPath && existsSync(step.screenshotPath)) {
          await client
            .send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `${baseKey}/steps/${encodeURIComponent(step.name)}.png`,
                Body: readFileSync(step.screenshotPath),
                ContentType: "image/png",
              }),
            )
            .catch((err) =>
              console.warn(`[s3] screenshot upload failed: ${err.message}`),
            );
        }
        if (step.tracePath && existsSync(step.tracePath)) {
          await client
            .send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: `${baseKey}/steps/${encodeURIComponent(step.name)}.trace.zip`,
                Body: readFileSync(step.tracePath),
                ContentType: "application/zip",
              }),
            )
            .catch((err) =>
              console.warn(`[s3] trace upload failed: ${err.message}`),
            );
        }
      }
    } catch (err) {
      console.warn(`[s3] exporter failed: ${(err as Error).message}`);
    }
  },
};
