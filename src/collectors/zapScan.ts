import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ZapReport } from '../types';

export async function runZapScan(targetUrl: string): Promise<ZapReport> {
  // Ensure zap-results directory exists
  try {
    mkdirSync('zap-results', { recursive: true });
  } catch (err) {
    // Directory already exists
  }

  // Call ZAP API to initiate scan
  const zapApiUrl = process.env.ZAP_API_URL || 'http://localhost:8080';
  
  try {
    // Start the spider scan
    const spiderScanResponse = await fetch(`${zapApiUrl}/JSON/spider/action/scan/?url=${encodeURIComponent(targetUrl)}&recurse=true&maxChildren=10&contextName=&subtreeOnly=`);
    const spiderData = await spiderScanResponse.json();
    const scanId = spiderData.scan;

    // Wait for spider to complete
    while (true) {
      const statusResponse = await fetch(`${zapApiUrl}/JSON/spider/view/status/?scanId=${scanId}`);
      const statusData = await statusResponse.json();
      if (statusData.status === "100") {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
    }

    // Start active scan
    const activeScanResponse = await fetch(`${zapApiUrl}/JSON/ascan/action/scan/?url=${encodeURIComponent(targetUrl)}&recurse=true&inScopeOnly=&scanPolicyName=&method=&postData=&contextId=`);
    const activeScanData = await activeScanResponse.json();
    const activeScanId = activeScanData.scan;

    // Wait for active scan to complete
    while (true) {
      const statusResponse = await fetch(`${zapApiUrl}/JSON/ascan/view/status/?scanId=${activeScanId}`);
      const statusData = await statusResponse.json();
      if (statusData.status === "100") {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before checking again
    }

    // Get alerts
    const alertsResponse = await fetch(`${zapApiUrl}/JSON/alert/view/alerts/?baseurl=${encodeURIComponent(targetUrl)}&start=0&count=100`);
    const alertsData = await alertsResponse.json();

    // Save raw report
    writeFileSync('./zap-results/report.json', JSON.stringify(alertsData, null, 2));

    return {
      timestamp: Date.now(),
      targetUrl,
      alerts: alertsData.alerts.map((alert: any) => ({
        risk: alert.riskcode,
        confidence: alert.confidence,
        name: alert.name,
        description: alert.description,
        solution: alert.solution,
        instances: alert.instances?.length || 1,
      })),
      summary: {
        high: alertsData.alerts.filter((a: any) => a.riskcode === 3).length,
        medium: alertsData.alerts.filter((a: any) => a.riskcode === 2).length,
        low: alertsData.alerts.filter((a: any) => a.riskcode === 1).length,
        info: alertsData.alerts.filter((a: any) => a.riskcode === 0).length,
      }
    };
  } catch (error) {
    console.error('Error during ZAP scan:', error);
    throw error;
  }
}