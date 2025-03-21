import fs from 'fs';
import path from 'path';
import type { Page } from '@playwright/test';
import type { VulnerabilityCounts } from '../types/index.js';

/**
 * Collector for ZAP security scan metrics
 */
export async function collectSecurityMetrics(page: Page, zapReportPath?: string): Promise<VulnerabilityCounts> {
  // Default path for ZAP JSON report from GitHub Action
  const reportPath = zapReportPath || 'report_json.json';
  
  try {
    if (!fs.existsSync(reportPath)) {
      console.warn(`ZAP JSON report not found at: ${reportPath}`);
      return { high: 0, medium: 0, low: 0, informational: 0, total: 0 };
    }

    const reportJson = fs.readFileSync(reportPath, 'utf8');
    const report = JSON.parse(reportJson);
    
    const counts: VulnerabilityCounts = {
      high: 0,
      medium: 0,
      low: 0,
      informational: 0,
      total: 0
    };

    // Process each site in the report
    if (report.site) {
      report.site.forEach((site: any) => {
        if (site.alerts) {
          site.alerts.forEach((alert: any) => {
            // Ensure count is a number (parse it if it's a string)
            const alertCount = parseInt(String(alert.count), 10) || 0;
            
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

    // Ensure all count values are numbers
    counts.high = parseInt(String(counts.high), 10) || 0;
    counts.medium = parseInt(String(counts.medium), 10) || 0;
    counts.low = parseInt(String(counts.low), 10) || 0;
    counts.informational = parseInt(String(counts.informational), 10) || 0;
    counts.total = parseInt(String(counts.total), 10) || 0;

    console.log('ZAP Vulnerability Counts:', counts);
    return counts;
  } catch (error: any) {
    console.error('Error parsing ZAP report:', error.message);
    return { high: 0, medium: 0, low: 0, informational: 0, total: 0 };
  }
}