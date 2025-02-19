import { test as base } from '@playwright/test';
import type { Page, TestInfoError } from '@playwright/test';
import { collectWebVitals } from './collectors/webVitals';
import { collectTestMetrics } from './collectors/testMetrics';
import { PrometheusExporter } from './exporters/prometheus';
import { S3Exporter } from './exporters/s3';
import { ZAPScanner } from './collectors/zapScan';
import type { MonitoringReport, ZAPScanOptions, MonitoringOptions } from './types';

const prometheusExporter = new PrometheusExporter();
const s3Exporter = new S3Exporter();
let zapScanner: ZAPScanner | null = null;

export const test = base.extend({
  monitoring: async ({ page, browserName }, use, testInfo) => {
    const startTime = Date.now();
    const zapApiUrl = process.env.ZAP_API_URL || 'http://localhost:8080';
    const zapApiKey = process.env.ZAP_API_KEY || '';
    
    await use(async (options?: MonitoringOptions) => {
      try {
        const baseUrl = new URL(options?.pages?.[0]?.url() || page.url()).origin;
        
        // Get Web Vitals from all pages
        const webVitals = options?.pages 
          ? await Promise.all(options.pages.map(p => collectWebVitals(p)))
          : await collectWebVitals(page);

        const testMetrics = await collectTestMetrics(page, testInfo, startTime);
        
        // Initialize ZAP scanner with the current page's context
        if (options?.securityScan) {
          // Create or reuse ZAP scanner
          if (!zapScanner) {
            zapScanner = new ZAPScanner(zapApiUrl, zapApiKey, baseUrl);
          }

          // Wait for page load and script execution
          await page.waitForLoadState('networkidle', { timeout: 30000 });
          
          // Get the authenticated cookies from the page
          const cookies = await page.context().cookies();
          const authHeaders: Record<string, string> = {
            Cookie: cookies.map(c => `${c.name}=${c.value}`).join('; ')
          };

          // Extract CSRF tokens if present
          const csrfToken = await page.evaluate(() => {
            const metaToken = document.querySelector('meta[name="csrf-token"]');
            const inputToken = document.querySelector('input[name="_csrf"]');
            return metaToken?.getAttribute('content') || 
                   inputToken?.getAttribute('value') || 
                   '';
          });

          if (csrfToken) {
            authHeaders['X-CSRF-Token'] = csrfToken;
          }

          // Configure scan options
          const scanOptions: ZAPScanOptions = {
            ...options?.scanOptions,
            authHeaders,
            maxRequestsPerSecond: options?.scanOptions?.maxRequestsPerSecond || 10,
            maxScanDuration: options?.scanOptions?.maxScanDuration || (options.isFullScan ? 14400 : 3600),
            failOnHighRisks: options?.scanOptions?.failOnHighRisks || false,
          };

          // Execute security scan
          const zapScan = await zapScanner.performScan(options.isFullScan, scanOptions);
          
          // Check for high-risk findings if configured
          if (scanOptions.failOnHighRisks && zapScan.stats.alertsByRisk.High > 0) {
            throw new Error(`Security scan failed: Found ${zapScan.stats.alertsByRisk.High} high-risk vulnerabilities`);
          }

          const report: MonitoringReport = {
            webVitals,
            testMetrics,
            timestamp: Date.now(),
            environment: {
              userAgent: await page.evaluate(() => navigator.userAgent),
              viewport: page.viewportSize() || { width: 0, height: 0 },
              browser: {
                name: browserName,
                version: await page.evaluate(() => navigator.userAgent.match(/Chrome\/([0-9.]+)/)?.[1] || ''),
                device: testInfo.project.name,
              },
            },
            zapScan
          };

          await Promise.all([
            prometheusExporter.export(report),
            s3Exporter.export(report, testInfo),
          ]).catch(error => {
            console.error('Failed to export monitoring data:', error);
            testInfo.errors.push({ 
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined
            } as TestInfoError);
          });
        }
      } catch (error) {
        console.error('Monitoring error:', error);
        throw error;
      }
    });
  },
});