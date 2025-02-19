import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type { ZapReport } from '../types';

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
        console.log(`Retry ${i + 1} after ${Math.round(delay)}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function zapRequest(
  url: string, 
  options: RequestInit = {}
): Promise<any> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`ZAP API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function checkApiAvailability(zapApiUrl: string): Promise<void> {
  let retries = 5;
  const retryDelay = 5000;

  while (retries > 0) {
    try {
      const response = await fetch(`${zapApiUrl}/JSON/core/view/version/`);
      if (response.ok) {
        const data = await response.json();
        console.log('ZAP API available, version:', data.version);
        return;
      }
    } catch (error) {
      console.log(`API check attempt failed, retries left: ${retries}`);
    }
    
    retries--;
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  throw new Error('ZAP API is not available after multiple retries');
}

async function pollProgress(zapApiUrl: string, endpoint: string, scanId: string, description: string): Promise<void> {
  let complete = false;
  let lastProgress = 0;
  let stuckCount = 0;

  while (!complete) {
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
      const status = await retryWithBackoff(() => 
        zapRequest(`${zapApiUrl}${endpoint}${scanId}`)
      );

      const currentProgress = parseInt(status.status);
      console.log(`${description} progress: ${currentProgress}%`);
      
      if (currentProgress === lastProgress) {
        stuckCount++;
        if (stuckCount > 12) {
          console.warn(`${description} appears to be stuck, forcing completion`);
          break;
        }
      } else {
        stuckCount = 0;
        lastProgress = currentProgress;
      }
      
      if (currentProgress === 100) {
        complete = true;
      }
    } catch (error) {
      console.warn(`Error checking ${description} status:`, error);
      // Continue polling even if we hit an error
    }
  }
}

export async function runZapScan(targetUrl: string): Promise<ZapReport> {
  try {
    mkdirSync('zap-results', { recursive: true });
  } catch (err) {
    // Directory already exists
  }

  const zapApiUrl = process.env.ZAP_API_URL || 'http://localhost:8080';
  console.log(`Initializing ZAP scan for ${targetUrl}`);

  try {
    await checkApiAvailability(zapApiUrl);

    // Access target URL first to ensure it's reachable
    console.log('Testing target URL accessibility...');
    await retryWithBackoff(() =>
      zapRequest(`${zapApiUrl}/JSON/core/action/accessUrl/?url=${encodeURIComponent(targetUrl)}`)
    );

    // Start spider scan first
    console.log('Starting spider scan...');
    const { scan: spiderId } = await retryWithBackoff(() =>
      zapRequest(`${zapApiUrl}/JSON/spider/action/scan/`, {
        method: 'POST',
        body: new URLSearchParams({
          url: targetUrl,
          maxChildren: '10',
          recurse: 'true',
          contextName: '',
          subtreeOnly: ''
        })
      })
    );

    console.log('Spider scan started with ID:', spiderId);
    await pollProgress(zapApiUrl, '/JSON/spider/view/status/?scanId=', spiderId, 'Spider scan');

    // Start the active scan
    console.log('Starting active scan...');
    const { scan: scanId } = await retryWithBackoff(() =>
      zapRequest(`${zapApiUrl}/JSON/ascan/action/scan/`, {
        method: 'POST',
        body: new URLSearchParams({
          url: targetUrl,
          recurse: 'true',
          inScopeOnly: 'false',
          scanPolicyName: 'Default Policy',
          method: 'GET',
          postData: ''
        })
      })
    );

    console.log('Active scan started with ID:', scanId);
    await pollProgress(zapApiUrl, '/JSON/ascan/view/status/?scanId=', scanId, 'Active scan');

    // Get scan results
    console.log('Fetching scan results...');
    const alertsData = await retryWithBackoff(() =>
      zapRequest(`${zapApiUrl}/JSON/alert/view/alerts/?baseurl=${encodeURIComponent(targetUrl)}`)
    );
    
    // Save raw report
    writeFileSync('./zap-results/report.json', JSON.stringify(alertsData, null, 2));

    const report: ZapReport = {
      timestamp: Date.now(),
      targetUrl,
      alerts: (alertsData.alerts || []).map((alert: any) => ({
        risk: Number(alert.riskcode) || 0,
        confidence: Number(alert.confidence) || 0,
        name: alert.name || 'Unknown Alert',
        description: alert.description || '',
        solution: alert.solution || '',
        instances: alert.instances?.length || 1,
      })),
      summary: {
        high: (alertsData.alerts || []).filter((a: any) => Number(a.riskcode) === 3).length,
        medium: (alertsData.alerts || []).filter((a: any) => Number(a.riskcode) === 2).length,
        low: (alertsData.alerts || []).filter((a: any) => Number(a.riskcode) === 1).length,
        info: (alertsData.alerts || []).filter((a: any) => Number(a.riskcode) === 0).length,
      }
    };

    console.log('Scan completed successfully');
    console.log('Scan summary:', report.summary);
    return report;

  } catch (error) {
    console.error('ZAP scan error:', error);
    
    // Create an error report
    const errorReport: ZapReport = {
      timestamp: Date.now(),
      targetUrl,
      alerts: [{
        risk: 3,
        confidence: 3,
        name: 'ZAP Scan Failed',
        description: `ZAP scan failed with error: ${(error as Error).message}`,
        solution: 'Check ZAP configuration and target URL accessibility',
        instances: 1
      }],
      summary: {
        high: 1,
        medium: 0,
        low: 0,
        info: 0
      }
    };

    // Save error information
    writeFileSync('./zap-results/error.log', 
      `${new Date().toISOString()}\n` +
      `Target URL: ${targetUrl}\n` +
      `ZAP API URL: ${zapApiUrl}\n` +
      `Error: ${(error as Error).message}\n` +
      `Stack: ${(error as Error).stack || 'No stack trace'}\n`
    );
    writeFileSync('./zap-results/report.json', JSON.stringify(errorReport, null, 2));

    return errorReport;
  }
}