// JavaScript version of the ZapReporter to avoid TypeScript loading issues
import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Registry, Gauge } from 'prom-client';

export class ZapReporter {
  constructor() {
    const region = process.env.AWS_REGION;
    const bucket = process.env.S3_BUCKET;
    const endpoint = process.env.S3_ENDPOINT;
    const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
    const tlsVerify = process.env.S3_TLS_VERIFY !== 'false';

    if (!region || !bucket) {
      throw new Error('AWS_REGION and S3_BUCKET environment variables must be set');
    }

    const clientConfig = {
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
    
    this.targetUrl = '';
  }

  /**
   * Parse the ZAP JSON report and count vulnerabilities by severity
   */
  async parseZapReport(reportPath = 'report_json.json') {
    try {
      if (!fs.existsSync(reportPath)) {
        console.error(`ZAP JSON report not found at: ${reportPath}`);
        return { high: 0, medium: 0, low: 0, informational: 0, total: 0 };
      }

      const reportJson = fs.readFileSync(reportPath, 'utf8');
      const report = JSON.parse(reportJson);
      
      const counts = {
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
              // Ensure count is a number (parse it if it's a string)
              const alertCount = parseInt(alert.count, 10) || 0;
              
              // Risk codes: 0=Informational, 1=Low, 2=Medium, 3=High
              switch (alert.riskcode) {
                case '3':
                  counts.high += alertCount;
                  break;
                case '2':
                  counts.medium += alertCount;
                  break;
                case '1':
                  counts.low += alertCount;
                  break;
                case '0':
                  counts.informational += alertCount;
                  break;
              }
              counts.total += alertCount;
            });
          }
        });
      }

      // Ensure all count values are numbers (not strings)
      counts.high = parseInt(counts.high, 10) || 0;
      counts.medium = parseInt(counts.medium, 10) || 0;
      counts.low = parseInt(counts.low, 10) || 0;
      counts.informational = parseInt(counts.informational, 10) || 0;
      counts.total = parseInt(counts.total, 10) || 0;

      console.log('ZAP Vulnerability Counts:', counts);
      return counts;
    } catch (error) {
      console.error('Error parsing ZAP report:', error.message);
      return { high: 0, medium: 0, low: 0, informational: 0, total: 0 };
    }
  }

  /**
   * Upload ZAP HTML report to S3
   */
  async uploadZapReport(htmlReportPath = 'report_html.html') {
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
      
    } catch (error) {
      console.error('Error uploading ZAP report to S3:', error.message);
    }
  }

  /**
   * Send vulnerability counts to Prometheus Pushgateway
   */
  async sendMetricsToPrometheus(counts) {
    try {
      const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
      if (!pushgatewayUrl) {
        throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
      }

      console.log(`Using Prometheus Pushgateway URL: ${pushgatewayUrl}`);

      // Ensure all counts are numbers
      const numericCounts = {
        high: Number(counts.high) || 0,
        medium: Number(counts.medium) || 0,
        low: Number(counts.low) || 0,
        informational: Number(counts.informational) || 0,
        total: Number(counts.total) || 0
      };

      console.log('Numeric vulnerability counts for Prometheus:', numericCounts);

      // Set vulnerability counts as Prometheus metrics
      this.securityVulnerabilitiesGauge.set({ severity: 'high', target_url: this.targetUrl }, numericCounts.high);
      this.securityVulnerabilitiesGauge.set({ severity: 'medium', target_url: this.targetUrl }, numericCounts.medium);
      this.securityVulnerabilitiesGauge.set({ severity: 'low', target_url: this.targetUrl }, numericCounts.low);
      this.securityVulnerabilitiesGauge.set({ severity: 'informational', target_url: this.targetUrl }, numericCounts.informational);
      this.securityVulnerabilitiesGauge.set({ severity: 'total', target_url: this.targetUrl }, numericCounts.total);

      // Get metrics in Prometheus format
      const metrics = await this.registry.metrics();
      
      console.log('Prepared metrics for Prometheus:');
      console.log(metrics.substring(0, 200) + '...'); // Log first part of metrics to avoid huge logs
      
      // Fix potential trailing slashes in URL and create the job URL
      // Don't append timestamp as part of the URL path
      const normalizedUrl = pushgatewayUrl.endsWith('/')
        ? `${pushgatewayUrl}metrics/job/security_scan`
        : `${pushgatewayUrl}/metrics/job/security_scan`;
      
      console.log(`Sending metrics to: ${normalizedUrl}`);
      
      // Add more detailed request options and proper error handling
      const response = await fetch(normalizedUrl, {
        method: 'POST',
        body: metrics,
        headers: {
          'Content-Type': 'text/plain',
        },
        timeout: 10000 // 10 second timeout
      });
      
      if (!response.ok) {
        const responseText = await response.text();
        throw new Error(`Failed to push metrics: ${response.status} ${response.statusText}\nResponse: ${responseText}`);
      }
      
      console.log(`Security vulnerability metrics sent to Prometheus successfully (${response.status} ${response.statusText})`);
      return true;
    } catch (error) {
      console.error('Error sending metrics to Prometheus:', error.message);
      console.error('Full error:', error);
      
      // Try alternative approach as fallback
      try {
        console.log('Trying alternative approach for sending metrics...');
        return await this.sendMetricsToPrometheusAlternative(counts);
      } catch (fallbackError) {
        console.error('Alternative approach also failed:', fallbackError.message);
        return false;
      }
    }
  }
  
  /**
   * Alternative method to send metrics to Prometheus using the same endpoint 
   * used by synthetic monitoring
   */
  async sendMetricsToPrometheusAlternative(counts) {
    const pushgatewayUrl = process.env.PROMETHEUS_PUSHGATEWAY;
    if (!pushgatewayUrl) {
      throw new Error('PROMETHEUS_PUSHGATEWAY environment variable not set');
    }
    
    // Ensure all counts are numbers
    const numericCounts = {
      high: Number(counts.high) || 0,
      medium: Number(counts.medium) || 0,
      low: Number(counts.low) || 0,
      informational: Number(counts.informational) || 0,
      total: Number(counts.total) || 0
    };
    
    // Use the same job name as synthetic monitoring for consistency
    const normalizedUrl = pushgatewayUrl.endsWith('/')
      ? `${pushgatewayUrl}metrics/job/synthetic_monitoring/instance/security_scan`
      : `${pushgatewayUrl}/metrics/job/synthetic_monitoring/instance/security_scan`;
    
    // Manually format metrics in Prometheus format for simplicity
    // IMPORTANT: Don't include timestamps as the Pushgateway doesn't want them
    let metricsText = '';
    
    // Add type and help info
    metricsText += '# HELP security_vulnerabilities_count Security vulnerabilities found by ZAP scan\n';
    metricsText += '# TYPE security_vulnerabilities_count gauge\n';
    
    // Add metrics with labels but WITHOUT timestamps
    metricsText += `security_vulnerabilities_count{severity="high",target_url="${this.targetUrl}"} ${numericCounts.high}\n`;
    metricsText += `security_vulnerabilities_count{severity="medium",target_url="${this.targetUrl}"} ${numericCounts.medium}\n`;
    metricsText += `security_vulnerabilities_count{severity="low",target_url="${this.targetUrl}"} ${numericCounts.low}\n`;
    metricsText += `security_vulnerabilities_count{severity="informational",target_url="${this.targetUrl}"} ${numericCounts.informational}\n`;
    metricsText += `security_vulnerabilities_count{severity="total",target_url="${this.targetUrl}"} ${numericCounts.total}\n`;
    
    console.log('Sending alternative metrics format to Prometheus:');
    console.log(metricsText);
    
    const response = await fetch(normalizedUrl, {
      method: 'POST',
      body: metricsText,
      headers: {
        'Content-Type': 'text/plain',
      }
    });
    
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Alternative approach failed: ${response.status} ${response.statusText}\nResponse: ${responseText}`);
    }
    
    console.log('Alternative metrics successfully sent to Prometheus');
    return true;
  }

  /**
   * Process ZAP reports: 
   * 1. Parse JSON report and calculate vulnerability counts
   * 2. Upload HTML report to S3
   * 3. Send metrics to Prometheus
   */
  async processZapReports() {
    const counts = await this.parseZapReport();
    await this.uploadZapReport();
    await this.sendMetricsToPrometheus(counts);
    return counts;
  }
}