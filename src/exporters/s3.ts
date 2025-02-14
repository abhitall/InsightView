import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import archiver from 'archiver';
import type { MonitoringReport } from '../types';
import type { TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export class S3Exporter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const region = process.env.AWS_REGION;
    const bucket = process.env.S3_BUCKET;
    const endpoint = process.env.S3_ENDPOINT;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
    const tlsVerify = process.env.S3_TLS_VERIFY !== 'false';

    if (!region || !bucket) {
      throw new Error('AWS_REGION and S3_BUCKET environment variables must be set');
    }

    const clientConfig: any = {
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      }
    };

    // Add endpoint configuration if provided
    if (endpoint) {
      clientConfig.endpoint = endpoint;
      clientConfig.forcePathStyle = forcePathStyle;
      
      // If TLS verification is disabled, configure the HTTP client
      if (!tlsVerify) {
        clientConfig.tls = false;
      }
    }

    this.bucket = bucket;
    this.client = new S3Client(clientConfig);
  }

  async export(report: MonitoringReport, testInfo: TestInfo): Promise<void> {
    const timestamp = new Date().toISOString();
    const { name: browser, device } = report.environment.browser;
    const key = `synthetics/${testInfo.title}/${browser}-${device}/trace-${timestamp}.zip`;

    const archive = await this.createArchive(report, testInfo);
    await this.uploadToS3(key, archive, {
      testName: testInfo.title,
      browser,
      device,
      status: testInfo.status || 'unknown',
    });
  }

  private async createArchive(report: MonitoringReport, testInfo: TestInfo): Promise<Buffer> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: any[] = [];

    // Add trace directory if it exists
    if (testInfo.outputDir && typeof testInfo.outputDir === 'string' && fs.existsSync(testInfo.outputDir)) {
      archive.directory(testInfo.outputDir, 'trace');
    }

    // Add report.json
    archive.append(JSON.stringify(report, null, 2), { name: 'report.json' });

    // Add test output file if it exists and is not empty
    if (typeof testInfo.outputPath === 'function') {
      const outputPath = testInfo.outputPath('test-output.txt');
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 0) {
          archive.file(outputPath, { name: 'test-output.txt' });
        }
      }
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