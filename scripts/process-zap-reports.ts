import { ZapReporter } from '../src/exporters/zapReporter';

/**
 * This script processes ZAP reports after a scan is complete:
 * 1. Parses the JSON report to count vulnerabilities by severity
 * 2. Uploads the HTML report to S3
 */
async function main() {
  try {
    console.log('Processing ZAP security scan reports...');
    
    const zapReporter = new ZapReporter();
    const counts = await zapReporter.processZapReports();
    
    // Print summary of vulnerabilities for CI/CD visibility
    console.log('\n==========================================');
    console.log('SECURITY SCAN RESULTS SUMMARY');
    console.log('==========================================');
    console.log(`High Risk Vulnerabilities: ${counts.high}`);
    console.log(`Medium Risk Vulnerabilities: ${counts.medium}`);
    console.log(`Low Risk Vulnerabilities: ${counts.low}`);
    console.log(`Informational Items: ${counts.informational}`);
    console.log(`Total Issues: ${counts.total}`);
    console.log('==========================================');
    
    if (counts.high > 0) {
      console.warn('⚠️ WARNING: High risk vulnerabilities detected!');
    }
    
    console.log('ZAP report processing completed successfully.');
  } catch (error: any) {
    console.error('Error processing ZAP reports:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);