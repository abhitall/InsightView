import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { collectWebVitals } from './collectors/webVitals.js';
import { collectTestMetrics } from './collectors/testMetrics.js';
import { collectSecurityMetrics } from './collectors/securityMetrics.js';
import { PrometheusExporter } from './exporters/prometheus.js';
import { S3Exporter } from './exporters/s3.js';
import { SecurityExporter } from './exporters/securityExporter.js';
import type { MonitoringReport, VulnerabilityCounts } from './types/index.js';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const prometheusExporter = new PrometheusExporter();
const s3Exporter = new S3Exporter();
const securityExporter = new SecurityExporter();

// Security scanning is enabled by default in PR and push events
const enableSecurityScan = process.env.ENABLE_SECURITY_SCAN !== 'false' && 
  (process.env.GITHUB_EVENT_NAME === 'pull_request' || 
   process.env.GITHUB_EVENT_NAME === 'push' ||
   process.env.FORCE_SECURITY_SCAN === 'true');

/**
 * Run ZAP security scan against a target URL
 */
async function runZapScan(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create temp dir for ZAP reports
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zap-scan-'));
    const jsonPath = path.join(tempDir, 'report.json');
    const htmlPath = path.join(tempDir, 'report.html');

    console.log(`Running ZAP security scan against ${url}`);
    console.log(`Reports will be saved to ${tempDir}`);
    
    // Build ZAP Docker command
    // This uses the same ZAP configuration as the GitHub Action
    const dockerCmd = [
      'run', '--rm',
      '-v', `${tempDir}:/zap/wrk:rw`,
      'ghcr.io/zaproxy/zaproxy:stable',
      'zap-baseline.py',
      '-t', url,
      '-J', 'report.json',
      '-r', 'report.html',
      '-a', // Include alpha passive scan rules
      '-j', // Use the Ajax spider
      '-d', // Debug mode
      '-I', // Don't fail on scan issues
    ];
    
    console.log(`Executing Docker command: docker ${dockerCmd.join(' ')}`);
    
    const process = spawn('docker', dockerCmd);
    let stdout = '';
    let stderr = '';

    process.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`ZAP: ${data.toString().trim()}`);
    });

    process.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`ZAP ERROR: ${data.toString().trim()}`);
    });

    process.on('close', (code) => {
      if (code !== 0) {
        console.error(`ZAP scan exited with code ${code}`);
        console.error(`stderr: ${stderr}`);
        // Don't reject, as we want to continue even if ZAP scan fails
      }
      
      // Copy reports to current directory for GitHub Actions artifacts
      try {
        if (fs.existsSync(jsonPath)) {
          fs.copyFileSync(jsonPath, 'report_json.json');
        }
        
        if (fs.existsSync(htmlPath)) {
          fs.copyFileSync(htmlPath, 'report_html.html');
        }
        
        resolve(tempDir);
      } catch (err) {
        console.error('Error copying ZAP reports:', err);
        reject(err);
      }
    });
  });
}

export const test = base.extend({
  monitoring: async ({ page, browserName }, use, testInfo) => {
    const startTime = Date.now();
    const url = page.url(); // Capture URL for security scanning
    let securityResults: VulnerabilityCounts | null = null;
    
    // Run ZAP security scan if enabled and this is a PR or push event
    if (enableSecurityScan) {
      try {
        const targetUrl = process.env.TEST_URL || url || 'http://example.com';
        console.log(`Security scanning enabled for ${targetUrl}`);
        
        // Run ZAP scan asynchronously - we'll process the results after the test
        runZapScan(targetUrl).catch(err => {
          console.error('Error running ZAP scan:', err);
        });
      } catch (err) {
        console.error('Failed to start security scan:', err);
      }
    } else {
      console.log('Security scanning disabled for this run');
    }
    
    await use(async (pages?: Page[] | void) => {
      // If pages array is provided, collect Web Vitals from all pages
      const webVitals = pages 
        ? await Promise.all(pages.map(p => collectWebVitals(p)))
        : await collectWebVitals(page);

      const testMetrics = await collectTestMetrics(page, testInfo, startTime);
      
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
      };

      // Process standard performance metrics
      await Promise.all([
        prometheusExporter.export(report),
        s3Exporter.export(report, testInfo),
      ]);
      
      // Process security scan results if security scanning was enabled
      if (enableSecurityScan) {
        try {
          // Check if ZAP report files exist
          if (fs.existsSync('report_json.json')) {
            console.log('Processing ZAP security scan results');
            securityResults = await collectSecurityMetrics(page, 'report_json.json');
            await securityExporter.export(securityResults, 'report_html.html', 'report_json.json');
          } else {
            console.log('ZAP report file not found, security results will be processed when available');
          }
        } catch (err) {
          console.error('Error processing security results:', err);
        }
      }
    });
  },
});