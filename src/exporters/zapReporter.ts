import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Registry, Gauge } from 'prom-client';

interface ZapAlert {
  pluginid: string;
  alertRef: string;
  alert: string;
  name: string;
  riskcode: string;
  confidence: string;
  riskdesc: string;
  desc: string;
  instances: Array<{
    uri: string;
    method: string;
    param: string;
    attack: string;
    evidence: string;
    otherinfo: string;
  }>;
  count: number;
  solution: string;
  reference: string;
  cweid: string;
  wascid: string;
  sourceid: string;
}

interface ZapReportData {
  '@version': string;
  '@generated': string;
  site: Array<{
    '@name': string;
    '@host': string;
    '@port': string;
    '@ssl': string;
    alerts: ZapAlert[];
  }>;
}

interface VulnerabilityCounts {
  high: number;
  medium: number;
  low: number;
  informational: number;
  total: number;
}

export class ZapReporter {
  private client: S3Client;
  private bucket: string;
  private registry: Registry;
  private securityVulnerabilitiesGauge: Gauge;
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
  }

  /**
   * Parse the ZAP JSON report and count vulnerabilities by severity
   */
  async parseZapReport(reportPath: string = 'report_json.json'): Promise<VulnerabilityCounts> {
    try {
      if (!fs.existsSync(reportPath)) {
        console.error(`ZAP JSON report not found at: ${reportPath}`);
        return { high: 0, medium: 0, low: 0, informational: 0, total: 0 };
      }

      const reportJson = fs.readFileSync(reportPath, 'utf8');
      const report: ZapReportData = JSON.parse(reportJson);
      
      const counts: VulnerabilityCounts = {
        high: 0,
        medium: 0,
        low: 0,
        informational: 0,
        total: 0
      };

      // Process each site in the report
      if (report.site) {
        report.site.forEach(site => {
          // Extract target URL from the report
          this.targetUrl = site['@name'] || process.env.TEST_URL || 'unknown';
          
          if (site.alerts) {
            site.alerts.forEach(alert => {
              // Risk codes: 0=Informational, 1=Low, 2=Medium, 3=High
              switch (alert.riskcode) {
                case '3':
                  counts.high += alert.count;
                  break;
                case '2':
                  counts.medium += alert.count;
                  break;
                case '1':
                  counts.low += alert.count;
                  break;
                case '0':
                  counts.informational += alert.count;
                  break;
              }
              counts.total += alert.count;
            });
          }
        });
      }

      console.log('ZAP Vulnerability Counts:', counts);
      return counts;
    } catch (error: any) {
      console.error('Error parsing ZAP report:', error.message);
      return { high: 0, medium: 0, low: 0, informational: 0, total: 0 };
    }
  }

  /**
   * Upload ZAP HTML report to S3
   */
  async uploadZapReport(htmlReportPath: string = 'report_html.html'): Promise<void> {
    try {
      if (!fs.existsSync(htmlReportPath)) {
        console.error(`ZAP HTML report not found at: ${htmlReportPath}`);
        return;
      }

      const timestamp = new Date().toISOString();
      const key = `security-reports/zap-scan-${timestamp}.html`;
      const htmlContent = fs.readFileSync(htmlReportPath);

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: htmlContent,
        ContentType: 'text/html',
        Metadata: {
          'scan-date': timestamp,
          'scan-type': 'zap-security',
        },
      });

      await this.client.send(command);
      console.log(`ZAP HTML report uploaded to S3: ${key}`);
      
      // Also upload JSON report for future reference
      if (fs.existsSync('report_json.json')) {
        const jsonCommand = new PutObjectCommand({
          Bucket: this.bucket,
          Key: `security-reports/zap-scan-${timestamp}.json`,
          Body: fs.readFileSync('report_json.json'),
          ContentType: 'application/json',
          Metadata: {
            'scan-date': timestamp,
            'scan-type': 'zap-security',
          },
        });
        
        await this.client.send(jsonCommand);
        console.log(`ZAP JSON report uploaded to S3`);
      }
      
    } catch (error: any) {
      console.error('Error uploading ZAP report to S3:', error.message);
    }
  }

  /**
   * Send vulnerability counts to Prometheus Pushgateway
   */
  async sendMetricsToPrometheus(counts: VulnerabilityCounts): Promise<void> {
    try {
      const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
      if (!pushgatewayUrl) {
        throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
      }

      // Set vulnerability counts as Prometheus metrics
      this.securityVulnerabilitiesGauge.set({ severity: 'high', target_url: this.targetUrl }, counts.high);
      this.securityVulnerabilitiesGauge.set({ severity: 'medium', target_url: this.targetUrl }, counts.medium);
      this.securityVulnerabilitiesGauge.set({ severity: 'low', target_url: this.targetUrl }, counts.low);
      this.securityVulnerabilitiesGauge.set({ severity: 'informational', target_url: this.targetUrl }, counts.informational);
      this.securityVulnerabilitiesGauge.set({ severity: 'total', target_url: this.targetUrl }, counts.total);

      // Get metrics in Prometheus format
      const metrics = await this.registry.metrics();
      
      // Push metrics to Pushgateway
      const response = await fetch(`${pushgatewayUrl}/metrics/job/security_scan`, {
        method: 'POST',
        body: metrics,
      });

      if (!response.ok) {
        throw new Error(`Failed to push metrics: ${response.status} ${response.statusText}`);
      }
      
      console.log('Security vulnerability metrics sent to Prometheus successfully');
    } catch (error: any) {
      console.error('Error sending metrics to Prometheus:', error.message);
    }
  }

  /**
   * Process ZAP reports: 
   * 1. Parse JSON report and calculate vulnerability counts
   * 2. Upload HTML report to S3
   * 3. Send metrics to Prometheus
   */
  async processZapReports(): Promise<VulnerabilityCounts> {
    const counts = await this.parseZapReport();
    await this.uploadZapReport();
    await this.sendMetricsToPrometheus(counts);
    return counts;
  }
}