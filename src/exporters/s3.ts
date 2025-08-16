import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import archiver from 'archiver';
import type { MonitoringReport } from '../types';
import type { TestInfo } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export class S3Exporter {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const bucket = process.env.S3_BUCKET;
    const endpoint = process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== 'false'; // Default to true for MinIO
    const tlsVerify = process.env.S3_TLS_VERIFY !== 'false';

    if (!bucket) {
      throw new Error('S3_BUCKET environment variable must be set');
    }

    if (!endpoint) {
      throw new Error('S3_ENDPOINT or MINIO_ENDPOINT environment variable must be set for MinIO');
    }

    const clientConfig: any = {
      region,
      endpoint,
      forcePathStyle,
      credentials: {
        // Try MinIO-specific env vars first, then fall back to AWS vars
        accessKeyId: process.env.MINIO_ACCESS_KEY || 
                    process.env.MINIO_ROOT_USER || 
                    process.env.AWS_ACCESS_KEY_ID || 
                    'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY || 
                        process.env.MINIO_ROOT_PASSWORD || 
                        process.env.AWS_SECRET_ACCESS_KEY || 
                        'minioadmin',
      }
    };

    // Configure HTTPS agent for custom endpoints
    if (endpoint.startsWith('https://')) {
      const agent = new https.Agent({
        rejectUnauthorized: tlsVerify,
      });
      clientConfig.requestHandler = new NodeHttpHandler({
        httpsAgent: agent,
      });
    }

    console.log('S3 Client Config:', {
      ...clientConfig,
      credentials: {
        accessKeyId: '***',
        secretAccessKey: '***'
      }
    });

    this.bucket = bucket;
    this.client = new S3Client(clientConfig);
  }

  async export(report: MonitoringReport, testInfo: TestInfo): Promise<void> {
    try {
      // Test connection first
      await this.testConnection();
      
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
      
      console.log(`Successfully uploaded to S3: ${key}`);
    } catch (error) {
      console.error('Failed to export to S3:', error);
      throw error;
    }
  }

  private async testConnection(): Promise<void> {
    try {
      const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
      await this.client.send(new ListBucketsCommand({}));
      console.log('S3 connection test successful');
    } catch (error: any) {
      console.error('S3 connection test failed:', error.message);
      throw new Error(`Cannot connect to S3/MinIO: ${error.message}`);
    }
  }

  private async createArchive(report: MonitoringReport, testInfo: TestInfo): Promise<Buffer> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: any[] = [];

    // Add test result directories if they exist
    const resultDirs = [
      { path: 'test-results', name: 'test-results' },
      { path: 'playwright-report', name: 'playwright-report' }
    ];

    for (const dir of resultDirs) {
      const fullPath = path.join(process.cwd(), dir.path);
      if (fs.existsSync(fullPath)) {
        try {
          const stats = fs.statSync(fullPath);
          if (stats.isDirectory()) {
            archive.directory(fullPath, dir.name);
            console.log(`Added ${dir.path} directory to archive`);
          }
        } catch (error) {
          console.warn(`Failed to add ${dir.path} directory:`, error);
        }
      } else {
        console.log(`${dir.path} directory not found`);
      }
    }

    // Add trace directory if it exists
    if (testInfo.outputDir && typeof testInfo.outputDir === 'string' && fs.existsSync(testInfo.outputDir)) {
      archive.directory(testInfo.outputDir, 'trace');
      console.log('Added trace directory to archive');
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
          console.log('Added test output file to archive');
        }
      }
    }

    // Add attachments (which includes videos and screenshots)
    if (Array.isArray(testInfo.attachments)) {
      for (const attachment of testInfo.attachments) {
        try {
          if (attachment.path && fs.existsSync(attachment.path)) {
            const attachmentStats = fs.statSync(attachment.path);
            if (attachmentStats.size > 0) {
              const attachmentType = attachment.contentType?.startsWith('video/') ? 'videos' : 'attachments';
              archive.file(attachment.path, { 
                name: `${attachmentType}/${attachment.name || path.basename(attachment.path)}` 
              });
              console.log(`Added ${attachmentType} attachment to archive: ${attachment.name || path.basename(attachment.path)}`);
            }
          }
        } catch (error) {
          console.warn(`Failed to add attachment ${attachment.name}:`, error);
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

    try {
      const result = await this.client.send(command);
      console.log('Upload successful:', { bucket: this.bucket, key });
    } catch (error: any) {
      console.error('S3 Upload Error:', {
        bucket: this.bucket,
        key,
        error: error.message,
        code: error.Code,
        endpoint: error.Endpoint || 'not provided'
      });
      throw error;
    }
  }
}