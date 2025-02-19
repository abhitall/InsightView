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

    if (endpoint) {
      // Custom S3-compatible service configuration
      clientConfig.endpoint = endpoint;
      clientConfig.forcePathStyle = forcePathStyle;
      if (!tlsVerify) {
        clientConfig.tls = false;
      }
    } else {
      // Let AWS SDK handle endpoints automatically
      clientConfig.useAccelerateEndpoint = false;
      clientConfig.useDualstackEndpoint = false;
      clientConfig.useFipsEndpoint = false;
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

    // Add ZAP scan results if available
    if (report.zapScan) {
      const zapResults = {
        ...report.zapScan,
        prNumber: process.env.GITHUB_PR_NUMBER || null,
        eventType: process.env.GITHUB_EVENT_NAME || 'manual',
        weekNumber: this.getWeekNumber(new Date(report.zapScan.timestamp)),
        year: new Date(report.zapScan.timestamp).getFullYear()
      };
      archive.append(JSON.stringify(zapResults, null, 2), { name: 'zap-scan-results.json' });

      // Store in appropriate structure based on scan context
      let basePath = 'security-scans';
      if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
        basePath = `${basePath}/pull-requests/pr-${process.env.GITHUB_PR_NUMBER}`;
      } else if (process.env.GITHUB_EVENT_NAME === 'schedule') {
        basePath = `${basePath}/${zapResults.year}/week-${zapResults.weekNumber}`;
      }

      const scanKey = `${basePath}/zap-scan-${report.zapScan.timestamp}.json`;
      await this.uploadToS3(scanKey, Buffer.from(JSON.stringify(zapResults)), {
        scanType: report.zapScan.scanType || 'zap-full-scan',
        context: process.env.GITHUB_EVENT_NAME || 'manual',
        prNumber: process.env.GITHUB_PR_NUMBER || '',
        weekNumber: zapResults.weekNumber.toString(),
        year: zapResults.year.toString(),
        targetUrl: report.zapScan.targetUrl
      });
    }

    archive.on('data', (chunk) => chunks.push(chunk));

    await new Promise((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
      archive.finalize();
    });

    return Buffer.concat(chunks);
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
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
      await this.client.send(command);
    } catch (error: any) {
      console.error('S3 Upload Error:', {
        bucket: this.bucket,
        key,
        error: error.message,
        code: error.Code,
        endpoint: error.Endpoint
      });
      throw error;
    }
  }
}