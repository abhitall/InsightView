import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Registry, Gauge } from 'prom-client';
import fs from 'fs';
import type { VulnerabilityCounts } from '../types/index.js';

/**
 * Exporter for security scan results
 * Sends security metrics to Prometheus and uploads reports to S3
 */
export class SecurityExporter {
  private client: S3Client;
  private bucket: string;
  private registry: Registry;
  private securityVulnerabilitiesGauge: Gauge<string>;
  private targetUrl: string = '';

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
    }

    this.bucket = bucket;
    this.client = new S3Client(clientConfig);
    
    // Initialize Prometheus metrics
    this.registry = new Registry();
    this.securityVulnerabilitiesGauge = new Gauge({
      name: 'security_vulnerabilities',
      help: 'Security vulnerabilities found by ZAP scan',
      labelNames: ['severity', 'target_url'],
      registers: [this.registry]
    });
    
    // Get target URL from environment
    this.targetUrl = process.env.TEST_URL || 'unknown';
  }

  /**
   * Export security metrics to Prometheus and upload reports to S3
   */
  async export(counts: VulnerabilityCounts, htmlReportPath: string = 'report_html.html', jsonReportPath: string = 'report_json.json'): Promise<void> {
    await Promise.all([
      this.uploadReports(htmlReportPath, jsonReportPath),
      this.sendMetricsToPrometheus(counts)
    ]);
  }

  /**
   * Upload ZAP HTML and JSON reports to S3
   */
  private async uploadReports(htmlReportPath: string, jsonReportPath: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      const htmlExists = fs.existsSync(htmlReportPath);
      const jsonExists = fs.existsSync(jsonReportPath);
      
      if (!htmlExists && !jsonExists) {
        console.error(`ZAP reports not found at: ${htmlReportPath} or ${jsonReportPath}`);
        return;
      }

      const uploadPromises: Promise<void>[] = [];

      // Upload HTML report if it exists
      if (htmlExists) {
        const htmlKey = `security-reports/zap-scan-${timestamp}.html`;
        const htmlContent = fs.readFileSync(htmlReportPath);

        const htmlCommand = new PutObjectCommand({
          Bucket: this.bucket,
          Key: htmlKey,
          Body: htmlContent,
          ContentType: 'text/html',
          Metadata: {
            'scan-date': timestamp,
            'scan-type': 'zap-security',
            'target-url': this.targetUrl
          }
        });

        uploadPromises.push(
          this.client.send(htmlCommand).then(() => {
            console.log(`ZAP HTML report uploaded to S3: ${htmlKey}`);
          })
        );
      }
      
      // Upload JSON report if it exists
      if (jsonExists) {
        const jsonKey = `security-reports/zap-scan-${timestamp}.json`;
        const jsonContent = fs.readFileSync(jsonReportPath);

        const jsonCommand = new PutObjectCommand({
          Bucket: this.bucket,
          Key: jsonKey,
          Body: jsonContent,
          ContentType: 'application/json',
          Metadata: {
            'scan-date': timestamp,
            'scan-type': 'zap-security',
            'target-url': this.targetUrl
          }
        });

        uploadPromises.push(
          this.client.send(jsonCommand).then(() => {
            console.log(`ZAP JSON report uploaded to S3: ${jsonKey}`);
          })
        );
      }

      await Promise.all(uploadPromises);
    } catch (error: any) {
      console.error('Error uploading ZAP report to S3:', error.message);
    }
  }

  /**
   * Send vulnerability counts to Prometheus
   */
  async sendMetricsToPrometheus(counts: VulnerabilityCounts): Promise<boolean> {
    try {
      const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
      if (!pushgatewayUrl) {
        throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
      }

      console.log(`Using Prometheus Pushgateway URL: ${pushgatewayUrl}`);

      // Set vulnerability counts as Prometheus metrics
      this.securityVulnerabilitiesGauge.set({ severity: 'high', target_url: this.targetUrl }, counts.high);
      this.securityVulnerabilitiesGauge.set({ severity: 'medium', target_url: this.targetUrl }, counts.medium);
      this.securityVulnerabilitiesGauge.set({ severity: 'low', target_url: this.targetUrl }, counts.low);
      this.securityVulnerabilitiesGauge.set({ severity: 'informational', target_url: this.targetUrl }, counts.informational);
      this.securityVulnerabilitiesGauge.set({ severity: 'total', target_url: this.targetUrl }, counts.total);

      // Get metrics in Prometheus format
      const metrics = await this.registry.metrics();
      
      // Fix potential trailing slashes in URL and create the job URL
      const normalizedUrl = pushgatewayUrl.endsWith('/')
        ? `${pushgatewayUrl}metrics/job/security_scan`
        : `${pushgatewayUrl}/metrics/job/security_scan`;
      
      console.log(`Sending metrics to: ${normalizedUrl}`);
      
      const response = await fetch(normalizedUrl, {
        method: 'POST',
        body: metrics,
        headers: {
          'Content-Type': 'text/plain',
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to push metrics: ${response.status} ${response.statusText}`);
      }
      
      console.log(`Security vulnerability metrics sent to Prometheus successfully`);
      return true;
    } catch (error: any) {
      console.error('Error sending metrics to Prometheus:', error.message);
      return false;
    }
  }
}