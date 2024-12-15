import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import archiver from 'archiver';
import type { MonitoringReport } from '../types';
import type { TestInfo } from '@playwright/test';

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export async function uploadTraceToS3(report: MonitoringReport, testInfo: TestInfo): Promise<void> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET environment variable not set');
  }

  const timestamp = new Date().toISOString();
  const { browser, device } = report.environment.browser;
  const baseKey = `synthetics/${testInfo.title}/${browser}-${device}/trace-${timestamp}`;

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

  const buffer = Buffer.concat(chunks);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: `${baseKey}.zip`,
    Body: buffer,
    ContentType: 'application/zip',
    Metadata: {
      testName: testInfo.title,
      browser,
      device,
      status: testInfo.status,
    },
  });

  await s3Client.send(command);
}