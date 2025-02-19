import type { ZapClient, ZapClientOptions } from '../types';
import type { ZAPScanResult, ZAPScanStats, AlertRisk, ZapResponse, ZapRequestConfig, ZAPScanOptions } from '../types';

export class ZAPScanner {
  private client: ZapClient;
  private targetUrl: string;
  private scanStartTime: number = 0;
  private readonly scanRetries = 3;
  private readonly scanRetryDelay = 5000;
  private readonly timeouts = {
    spider: 7200000,     // 2 hours
    ajaxSpider: 7200000, // 2 hours
    activeScan: 14400000 // 4 hours
  };

  constructor(zapApiUrl: string, apiKey: string, targetUrl: string) {
    if (!zapApiUrl || !targetUrl) {
      throw new Error('ZAP API URL and target URL are required');
    }

    // Initialize client with error handling
    try {
      const options: ZapClientOptions = {
        apiKey,
        proxy: process.env.ZAP_PROXY_URL || 'http://localhost:8080',
        rejectUnauthorized: false,
        requestConfig: {
          timeout: 120000,
          responseEncoding: 'utf8',
          validateStatus: (status: number) => status < 500
        }
      };

      this.client = new (require('@zaproxy/zap-api-client').ZapClient)(zapApiUrl, options);
      this.targetUrl = targetUrl;

      // Add cleanup handler
      process.on('beforeExit', async () => {
        await this.cleanup().catch(error => {
          console.error('Failed to cleanup ZAP scanner:', error);
        });
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initialize ZAP client: ${errorMsg}`);
    }
  }

  private async initializeClient(zapApiUrl: string, apiKey: string) {
    const options: ZapClientOptions = {
      apiKey,
      proxy: process.env.ZAP_PROXY_URL || 'http://localhost:8080',
      rejectUnauthorized: false,
      requestConfig: {
        timeout: 120000,
        responseEncoding: 'utf8',
        validateStatus: (status: number) => status < 500
      }
    };

    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= this.scanRetries; attempt++) {
      try {
        this.client = new (require('@zaproxy/zap-api-client').ZapClient)(zapApiUrl, options);
        await this.verifyZapConnection();
        console.log('Successfully connected to ZAP API');
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`ZAP connection attempt ${attempt}/${this.scanRetries} failed:`, lastError.message);
        if (attempt < this.scanRetries) {
          const delay = this.scanRetryDelay * attempt;
          console.log(`Retrying in ${delay/1000} seconds...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw new Error(`Failed to initialize ZAP client after ${this.scanRetries} attempts: ${lastError?.message}`);
  }

  private async verifyZapConnection(): Promise<void> {
    try {
      const version = await this.client.core.version();
      if (!version) {
        throw new Error('No version returned from ZAP API');
      }
      console.log(`Connected to ZAP version: ${version}`);
    } catch (error) {
      throw new Error(`Failed to verify ZAP connection: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private logScanStatus(phase: string, message: string): void {
    const elapsed = ((Date.now() - this.scanStartTime) / 1000).toFixed(1);
    const sanitizedMessage = this.sanitizeUrl(message);
    console.log(`[ZAP ${phase}] (${elapsed}s) ${sanitizedMessage}`);
  }

  private async withRetry<T>(operation: () => Promise<T>, name: string): Promise<T> {
    let lastError: Error | undefined;
    let backoffDelay = this.scanRetryDelay;
    
    for (let attempt = 1; attempt <= this.scanRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isNetworkError = lastError.message.includes('ECONNREFUSED') || 
                              lastError.message.includes('ETIMEDOUT') ||
                              lastError.message.includes('socket hang up');

        this.logScanStatus('Retry', 
          `${name} failed (attempt ${attempt}/${this.scanRetries}): ${lastError.message} ` +
          `[${isNetworkError ? 'Network Error' : 'Operation Error'}]`
        );

        if (attempt < this.scanRetries) {
          // Exponential backoff for network errors
          if (isNetworkError) {
            backoffDelay *= 2;
          }
          this.logScanStatus('Retry', `Waiting ${backoffDelay/1000}s before retry...`);
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }
    
    throw new Error(`${name} failed after ${this.scanRetries} attempts. Last error: ${lastError?.message}`);
  }

  private async configureZapSettings(options: ZAPScanOptions): Promise<void> {
    await this.withRetry(async () => {
      // Weekly image may need additional time for startup
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Basic settings with defaults that work well with weekly image
      await this.client.core.setOptionDefaultUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
      );
      await this.client.core.setOptionHttpStateEnabled(true);
      await this.client.core.setOptionFollowRedirects(true);

      // Performance optimizations for weekly image
      const threadCount = Math.min(options.threadCount || 4, 6); // Cap at 6 threads
      await this.client.core.setOptionHostPerScan(threadCount);
      await this.client.core.setOptionThreadPerHost(threadCount);
      
      // Reduced delays for weekly image's improved performance
      const minDelay = Math.ceil(1000 / (options.maxRequestsPerSecond || 10));
      await this.client.spider.setOptionDelayInMs(minDelay);
      await this.client.ascan.setOptionDelayInMs(minDelay);

      // Resource limits suitable for weekly image
      await this.client.spider.setOptionMaxParseSizeBytes(10485760); // 10MB
      await this.client.core.setOptionMaxResponseSize(20971520); // 20MB

      // Weekly image specific scan policy settings
      if (options.scanPolicyName) {
        try {
          await this.client.ascan.importScanPolicy(options.scanPolicyName);
        } catch (error) {
          console.warn(`Failed to import scan policy ${options.scanPolicyName}, using default:`, error);
        }
      }
    }, 'ZAP Configuration');
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    phase: string,
    maxRetries: number = this.scanRetries
  ): Promise<{ result: T | null; error: Error | null }> {
    let lastError: Error | null = null;
    let backoffDelay = this.scanRetryDelay;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 1) {
          this.logScanStatus(phase, `Succeeded after ${attempt} attempts`);
        }
        return { result, error: null };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const isNetworkError = lastError.message.includes('ECONNREFUSED') || 
                             lastError.message.includes('ETIMEDOUT') ||
                             lastError.message.includes('socket hang up');

        this.logScanStatus(phase, 
          `Attempt ${attempt}/${maxRetries} failed: ${lastError.message} ` +
          `[${isNetworkError ? 'Network Error' : 'Operation Error'}]`
        );

        if (attempt < maxRetries) {
          if (isNetworkError) {
            backoffDelay *= 2;
          }
          await new Promise(resolve => setTimeout(resolve, backoffDelay));
        }
      }
    }

    return { result: null, error: lastError };
  }

  private async executePhase<T>(
    phase: string, 
    operation: () => Promise<T>,
    stats: ZAPScanStats,
    errors: Array<{ phase: string; message: string; timestamp: string }>
  ): Promise<T | null> {
    const startTime = Date.now();
    const { result, error } = await this.retryOperation(operation, phase);
    
    if (error) {
      errors.push({
        phase,
        message: error.message,
        timestamp: new Date().toISOString()
      });
      this.logScanStatus('Error', `${phase} failed after all retries: ${error.message}`);
      return null;
    }

    const duration = Date.now() - startTime;
    const timeMetricKey = phase.toLowerCase().replace(/\s+/g, '') + 'Duration' as keyof typeof stats.timeMetrics;
    if (timeMetricKey in stats.timeMetrics) {
      stats.timeMetrics[timeMetricKey] = duration;
    }

    return result;
  }

  private async executeScanPhase(
    phase: string,
    operation: () => Promise<void>,
    stats: ZAPScanStats,
    errors: Array<{ phase: string; message: string; timestamp: string }>
  ): Promise<boolean> {
    try {
      await this.executePhase(phase, operation, stats, errors);
      return true;
    } catch (error) {
      return false;
    }
  }

  private async handleSpiderPhase(
    contextName: string,
    stats: ZAPScanStats,
    errors: Array<{ phase: string; message: string; timestamp: string }>
  ): Promise<boolean> {
    return await this.executeScanPhase(
      'Spider',
      async () => {
        const spiderScanId = await this.withRetry(
          () => this.client.spider.scan(this.targetUrl, undefined, true, contextName, true),
          'Spider Scan Start'
        );
        await this.waitForSpiderCompletion(spiderScanId);
      },
      stats,
      errors
    );
  }

  private async handleAjaxSpiderPhase(
    contextName: string,
    stats: ZAPScanStats,
    errors: Array<{ phase: string; message: string; timestamp: string }>
  ): Promise<boolean> {
    return await this.executeScanPhase(
      'AJAX Spider',
      async () => {
        await this.withRetry(
          () => this.client.ajaxSpider.scan(this.targetUrl, true, contextName, true),
          'AJAX Spider Start'
        );
        await this.waitForAjaxSpiderCompletion();
      },
      stats,
      errors
    );
  }

  private async handleActiveScanPhase(
    contextName: string,
    isFullScan: boolean,
    stats: ZAPScanStats,
    errors: Array<{ phase: string; message: string; timestamp: string }>
  ): Promise<boolean> {
    return await this.executeScanPhase(
      'Active Scan',
      async () => {
        const scanOptions = {
          maxDuration: isFullScan ? 14400 : 3600,
          maxAlertsPerRule: isFullScan ? 0 : 10,
          maxScansInUI: isFullScan ? 10 : 5,
          threadPerHost: isFullScan ? 6 : 3,
          delayInMs: isFullScan ? 0 : 200,
          handleAntiCSRFTokens: true,
          injectPluginIdInHeader: true,
          alertThreshold: isFullScan ? 'MEDIUM' : 'HIGH',
          attackStrength: isFullScan ? 'HIGH' : 'MEDIUM'
        };

        const scanId = await this.withRetry(
          () => this.client.ascan.scan(
            this.targetUrl,
            true,
            true,
            isFullScan ? 'Default Policy' : 'Light Policy',
            undefined,
            undefined,
            scanOptions
          ),
          'Active Scan Start'
        );

        await this.waitForScanCompletion(scanId);
      },
      stats,
      errors
    );
  }

  private async throttleScan(operation: () => Promise<void>): Promise<void> {
    const maxRequestsPerSecond = 10;
    const requestWindow = 1000; // 1 second
    let requestCount = 0;
    let windowStart = Date.now();

    const rateLimiter = async () => {
      const now = Date.now();
      if (now - windowStart >= requestWindow) {
        // Reset window
        requestCount = 0;
        windowStart = now;
      } else if (requestCount >= maxRequestsPerSecond) {
        // Wait until current window ends
        const delay = windowStart + requestWindow - now;
        await new Promise(resolve => setTimeout(resolve, delay));
        requestCount = 0;
        windowStart = Date.now();
      }
      requestCount++;
      await new Promise(resolve => setTimeout(resolve, 1000 / maxRequestsPerSecond));
    };

    // Apply rate limiting through periodic delays
    while (true) {
      try {
        await operation();
        break;
      } catch (error) {
        if (error instanceof Error && error.message.includes('rate limit')) {
          await rateLimiter();
          continue;
        }
        throw error;
      }
    }
  }

  private calculateScanDelay(isFullScan: boolean): number {
    // Adjust delay based on scan type
    const baseDelay = isFullScan ? 100 : 200;
    const jitter = Math.floor(Math.random() * 50); // Add random jitter
    return baseDelay + jitter;
  }

  private async pauseBetweenRequests(isFullScan: boolean): Promise<void> {
    const delay = this.calculateScanDelay(isFullScan);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  private async parseZapResponse<T>(response: any, operation: string): Promise<T> {
    try {
      // Check for ZAP error responses
      if (response.code && response.code !== "ok") {
        throw new Error(`ZAP ${operation} failed: ${response.code} - ${response.message || 'Unknown error'}`);
      }

      // Handle different response formats
      if (response.alerts) return response.alerts as T;
      if (Array.isArray(response)) return response as T;
      if (typeof response === 'string') {
        // Try to parse as number first
        const num = parseInt(response);
        if (!isNaN(num)) return num as unknown as T;
        return response as unknown as T;
      }

      return response as T;
    } catch (error) {
      throw new Error(`Failed to parse ZAP response for ${operation}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private formatErrorReport(errors: Array<{ phase: string; message: string; timestamp: string }>): string {
    if (errors.length === 0) return 'No errors occurred during the scan.';

    const errorsByPhase = errors.reduce((acc, error) => {
      if (!acc[error.phase]) acc[error.phase] = [];
      acc[error.phase].push(`[${error.timestamp}] ${error.message}`);
      return acc;
    }, {} as Record<string, string[]>);

    return Object.entries(errorsByPhase)
      .map(([phase, messages]) => {
        return `${phase}:\n  ${messages.join('\n  ')}`;
      })
      .join('\n\n');
  }

  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove sensitive query parameters
      const sensitiveParams = ['key', 'token', 'password', 'secret', 'auth'];
      sensitiveParams.forEach(param => urlObj.searchParams.delete(param));
      return urlObj.toString();
    } catch {
      // If URL parsing fails, return sanitized original
      return url.replace(/[?&](key|token|password|secret|auth)=[^&]*/gi, '');
    }
  }

  async performScan(isFullScan: boolean = false, options: ZAPScanOptions): Promise<ZAPScanResult> {
    await this.verifyZapConnection();
    const contextName = `scan-context-${Date.now()}`;
    this.scanStartTime = Date.now();
    
    try {
      await this.configureZapSettings(options);
      
      // Set up authentication headers
      await this.withRetry(async () => {
        for (const [header, value] of Object.entries(options.authHeaders)) {
          await this.client.core.setOptionDefaultHeader(`${header}: ${value}`);
        }
      }, 'Setting Auth Headers');

      // Initialize context with auth configuration
      await this.initializeContext(contextName, options);

      // Rest of scan execution
      return await this.executeScan(contextName, isFullScan, options);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errors: Array<{ phase: string; message: string; timestamp: string }> = [{
        phase: 'Fatal Error',
        message: errorMsg,
        timestamp: new Date().toISOString()
      }];

      // Return partial results if available
      const partialResults: Partial<ZAPScanResult> = {
        scanId: Date.now(),
        duration: Date.now() - this.scanStartTime,
        timestamp: new Date().toISOString(),
        targetUrl: this.targetUrl,
        scanType: isFullScan ? 'full' : 'quick',
        contextName,
        stats: {
          totalUrls: 0,
          uniqueUrls: 0,
          requestCount: 0,
          alertsByRisk: {
            High: 0,
            Medium: 0,
            Low: 0,
            Informational: 0
          },
          timeMetrics: {
            spiderDuration: 0,
            ajaxSpiderDuration: 0,
            activeScanDuration: 0,
            totalDuration: 0
          }
        },
        errors,
        errorReport: this.formatErrorReport(errors),
        status: 'failed'
      };

      throw new Error(`Scan failed: ${errorMsg}\n\nPartial Results: ${JSON.stringify(partialResults, null, 2)}`);
    }
  }

  private async verifyAuthentication(contextName: string): Promise<boolean> {
    try {
      // Check for authenticated session by attempting to access a known authenticated URL
      const message = await this.client.core.newMessage();
      const response = await this.client.core.messageResponse(message);
      
      // Check response for authentication indicators
      const statusCode = await this.client.core.messageResponseStatusCode(message);
      return statusCode < 400;
    } catch (error) {
      this.logScanStatus('Auth Check', 'Failed to verify authentication status');
      return false;
    }
  }

  private async handleAuthentication(contextName: string, options: ZAPScanOptions): Promise<void> {
    await this.withRetry(async () => {
      // Configure HTTP session handling
      await this.client.httpsessions.createEmptySession(this.targetUrl, 'auth-session');
      await this.client.httpsessions.setActiveSession(this.targetUrl, 'auth-session');
      
      // Add auth headers to session
      for (const [header, value] of Object.entries(options.authHeaders)) {
        await this.client.httpsessions.addSessionToken(contextName, header);
        await this.client.core.setOptionDefaultHeader(`${header}: ${value}`);
      }

      // Enable session handling
      await this.client.core.setOptionSingleCookieRequestHeader(true);
      await this.client.core.setOptionUseHttpState(true);
    }, 'Session Configuration');

    // Verify authentication
    const isAuthenticated = await this.verifyAuthentication(contextName);
    if (!isAuthenticated) {
      throw new Error('Failed to establish authenticated session with target');
    }
  }

  private async initializeContext(contextName: string, options: ZAPScanOptions): Promise<void> {
    await this.withRetry(async () => {
      // Create and configure context
      await this.client.context.newContext(contextName);
      await this.client.context.includeInContext(contextName, this.targetUrl);
      
      // Set up session management
      await this.client.context.setContextInScope(contextName, true);
      await this.client.sessionManagement.setSessionManagementMethod(
        contextName,
        'cookieBasedSessionManagement',
        null
      );

      // Configure URL handling
      if (options.includeUrls?.length) {
        for (const url of options.includeUrls) {
          await this.client.context.includeInContext(contextName, url);
        }
      }
      
      if (options.excludeUrls?.length) {
        for (const url of options.excludeUrls) {
          await this.client.context.excludeFromContext(contextName, url);
        }
      }

      // Handle authentication
      await this.handleAuthentication(contextName, options);
    }, 'Context Initialization');
  }

  private async executeScan(contextName: string, isFullScan: boolean, options: ZAPScanOptions): Promise<ZAPScanResult> {
    const stats: ZAPScanStats = {
      totalUrls: 0,
      uniqueUrls: 0,
      requestCount: 0,
      alertsByRisk: {
        High: 0,
        Medium: 0,
        Low: 0,
        Informational: 0
      },
      timeMetrics: {
        spiderDuration: 0,
        ajaxSpiderDuration: 0,
        activeScanDuration: 0,
        totalDuration: 0
      }
    };

    const errors: Array<{ phase: string; message: string; timestamp: string }> = [];
    const threadCount = Math.min(options.threadCount || 4, 6);
    const minDelay = Math.ceil(1000 / (options.maxRequestsPerSecond || 10));

    try {
      // Initialize scan with weekly image compatibility
      await this.withRetry(async () => {
        await this.client.core.newSession('', '');
        await this.configureZapSettings(options);
      }, 'Scan Initialization');

      // Execute spider with weekly image optimizations
      const spiderResult = await this.withRetry<string>(
        async () => {
          const result = await this.client.spider.scan(
            this.targetUrl,
            options.maxDepth || 5,
            true,
            contextName,
            true
          );
          return result.toString();
        },
        'Spider Scan Start'
      );

      await this.waitForSpiderCompletion(spiderResult);
      
      // Execute active scan with weekly image optimizations
      const scanResult = await this.withRetry<string>(
        async () => {
          const result = await this.client.ascan.scan(
            this.targetUrl,
            true,
            true,
            options.scanPolicyName || 'Default Policy',
            undefined,
            undefined,
            {
              maxDuration: options.maxScanDuration,
              maxAlertsPerRule: isFullScan ? 0 : 10,
              maxScansInUI: threadCount,
              threadPerHost: threadCount,
              delayInMs: minDelay,
              handleAntiCSRFTokens: true
            }
          );
          return result.toString();
        },
        'Active Scan Start'
      );

      await this.waitForScanCompletion(scanResult);

      // Collect results
      return await this.collectScanResults(contextName, stats, isFullScan, errors);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({
        phase: 'Scan Execution',
        message: errorMsg,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  private async collectScanResults(contextName: string, stats: ZAPScanStats, isFullScan: boolean, errors: Array<{ phase: string; message: string; timestamp: string }>): Promise<ZAPScanResult> {
    const [alerts, requestCount] = await Promise.all([
      this.withRetry(() => this.client.core.alertsByContext(contextName), 'Alert Collection')
        .then(response => this.parseZapResponse<any[]>(response, 'Alert Collection')),
      this.withRetry(() => this.client.core.numberOfMessages({ baseurl: this.targetUrl }), 'Request Count')
        .then(response => this.parseZapResponse<string>(response, 'Request Count'))
        .then(count => parseInt(count) || 0)
    ]);

    stats.requestCount = requestCount;
    alerts.forEach(alert => {
      const risk = alert.risk as AlertRisk;
      stats.alertsByRisk[risk]++;
    });

    stats.timeMetrics.totalDuration = Date.now() - this.scanStartTime;

    return {
      scanId: Date.now(),
      duration: stats.timeMetrics.totalDuration,
      timestamp: new Date().toISOString(),
      targetUrl: this.targetUrl,
      scanType: isFullScan ? 'full' : 'quick',
      contextName,
      stats,
      alerts: alerts.map(alert => ({
        risk: alert.risk as AlertRisk,
        confidence: alert.confidence,
        url: this.sanitizeUrl(alert.url),
        name: alert.name,
        description: alert.description,
        solution: alert.solution,
        reference: alert.reference,
        param: alert.param,
        attack: alert.attack,
        evidence: alert.evidence,
        cweId: alert.cweid,
        wascId: alert.wascid,
        scanId: parseInt(alert.pluginid) || undefined,
        pluginId: alert.pluginid,
        other: alert.other
      })),
      status: 'completed',
      errors,
      errorReport: this.formatErrorReport(errors)
    };
  }

  async addTargetToContext(url: string): Promise<void> {
    const urlObj = new URL(url);
    const pattern = `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}.*`;
    
    await this.withRetry(async () => {
      await this.client.context.includeInContext('scan-context', pattern);
      await this.client.context.setContextInScope('scan-context', true);
    }, `Add URL to Context: ${url}`);
  }

  private async waitForCompletion<T>(
    checkStatus: () => Promise<T>,
    isComplete: (status: T) => boolean,
    operation: string,
    timeout: number
  ): Promise<void> {
    const startTime = Date.now();
    let lastProgress = 0;
    let staleCount = 0;
    const maxStaleChecks = 12; // 1 minute of no progress (5s * 12)

    do {
      if (Date.now() - startTime > timeout) {
        throw new Error(`${operation} timed out after ${timeout/1000} seconds`);
      }

      await new Promise(resolve => setTimeout(resolve, 5000));
      
      try {
        const status = await this.withRetry(() => checkStatus(), `${operation} Status Check`);
        
        // Check for stalled progress
        if (typeof status === 'string') {
          const progress = parseInt(status, 10);
          if (!isNaN(progress) && progress === lastProgress) {
            staleCount++;
            if (staleCount >= maxStaleChecks) {
              throw new Error(`${operation} appears to be stalled at ${progress}% for over 1 minute`);
            }
          } else {
            staleCount = 0;
            lastProgress = progress;
            this.logScanStatus(operation, `Progress: ${progress}%`);
          }
        }

        if (isComplete(status)) {
          return;
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('stalled')) {
          throw error; // Re-throw stall errors
        }
        this.logScanStatus('Error', `${operation} status check failed: ${error}`);
        throw error;
      }

    } while (true);
  }

  private async waitForSpiderCompletion(scanId: string): Promise<void> {
    await this.waitForCompletion(
      () => this.client.spider.status(scanId),
      (status: string) => {
        const progress = parseInt(status, 10);
        if (isNaN(progress)) {
          throw new Error(`Invalid spider status: ${status}`);
        }
        return progress >= 100;
      },
      'Spider Scan',
      this.timeouts.spider
    );
  }

  private async waitForAjaxSpiderCompletion(): Promise<void> {
    await this.waitForCompletion(
      () => this.client.ajaxSpider.status(),
      (status: string) => status !== 'running',
      'AJAX Spider',
      this.timeouts.ajaxSpider
    );
  }

  private async waitForScanCompletion(scanId: string): Promise<void> {
    await this.waitForCompletion(
      () => this.client.ascan.status(scanId),
      (status: string) => {
        const progress = parseInt(status, 10);
        if (isNaN(progress)) {
          throw new Error(`Invalid scan status: ${status}`);
        }
        return progress >= 100;
      },
      'Active Scan',
      this.timeouts.activeScan
    );
  }

  private async cleanup(): Promise<void> {
    try {
      // Stop any running scans
      const spiderStatus = await this.client.spider.status('0');
      if (spiderStatus !== '100') {
        console.log('Stopping spider scan...');
        await this.client.spider.stop('0');
      }

      const scanStatus = await this.client.ascan.status('0');
      if (scanStatus !== '100') {
        console.log('Stopping active scan...');
        await this.client.ascan.stop('0');
      }

      // Save session if needed
      if (process.env.ZAP_SAVE_SESSION === 'true') {
        const sessionName = `zap-session-${Date.now()}.session`;
        console.log(`Saving session as ${sessionName}...`);
        await this.client.core.saveSession(sessionName);
      }

      console.log('ZAP scanner cleanup completed');
    } catch (error) {
      console.error('Error during ZAP scanner cleanup:', error);
      throw error;
    }
  }

  public async dispose(): Promise<void> {
    await this.cleanup();
  }
}