import { exec } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { ZapReport } from '../types';

export async function runZapScan(targetUrl: string): Promise<ZapReport> {
  const containerName = 'zap-scan';
  const reportFile = '/zap/wrk/report.json';
  
  // Run ZAP scan in container
  await new Promise((resolve, reject) => {
    const cmd = `docker run --rm --name ${containerName} \
      -v "$(pwd)/zap-results:/zap/wrk" \
      -t ghcr.io/zaproxy/zaproxy:stable \
      zap-baseline.py -t ${targetUrl} \
      -J ${reportFile} \
      -I -j --auto`;

    exec(cmd, (error: any, stdout: string, stderr: string) => {
      console.log(stdout);
      console.error(stderr);
      if (error && error.code !== 0 && error.code !== 2) {
        // ZAP returns 2 when issues are found, which is expected
        reject(error);
      }
      resolve(undefined);
    });
  });

  // Read and parse the report
  const report = JSON.parse(readFileSync('./zap-results/report.json', 'utf8'));

  return {
    timestamp: Date.now(),
    targetUrl,
    alerts: report.site[0].alerts.map((alert: any) => ({
      risk: alert.riskcode,
      confidence: alert.confidence,
      name: alert.name,
      description: alert.desc,
      solution: alert.solution,
      instances: alert.instances.length,
    })),
    summary: {
      high: report.site[0].alerts.filter((a: any) => a.riskcode === 3).length,
      medium: report.site[0].alerts.filter((a: any) => a.riskcode === 2).length,
      low: report.site[0].alerts.filter((a: any) => a.riskcode === 1).length,
      info: report.site[0].alerts.filter((a: any) => a.riskcode === 0).length,
    }
  };
}