import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import archiver from 'archiver';
import type { MonitoringReport } from '../types';
import type { TestInfo } from '@playwright/test';

export class S3Exporter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const region = process.env.AWS_REGION;
    const bucket = process.env.S3_BUCKET;

    if (!region || !bucket) {
      throw new Error('AWS_REGION and S3_BUCKET environment variables must be set');
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async export(report: MonitoringReport, testInfo: TestInfo): Promise<void> {
    const timestamp = new Date().toISOString();
    const { browser, device } = report.environment.browser;
    const key = `synthetics/${testInfo.title}/${browser}-${device}/trace-${timestamp}.zip`;

    const archive = await this.createArchive(report, testInfo);
    await this.uploadToS3(key, archive, {
      testName: testInfo.title,
      browser,
      device,
      status: testInfo.status,
    });
  }

  private async createArchive(report: MonitoringReport, testInfo: TestInfo): Promise<Buffer> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: any[] = [];

    archive.directory(testInfo.outputDir, 'trace');
    archive.append(JSON.stringify(report, null, 2), { name: 'report.json' });

    if (testInfo.outputPath) {
      archive.file(testInfo.outputPath, { name: 'test-output.txt' });
    }

    archive.on('data', (chunk) => chunks.push(chunk));

    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
      archive.finalize();
    });

    return Buffer.concat(chunks);
  }

  private async uploadToS3(key: string, body: Buffer, metadata: Record<string, string>): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: 'application/zip',
      Metadata: metadata,
    });

    await this.client.send(command);
  }
}