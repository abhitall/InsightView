# Security Testing Guide

## Overview
This guide explains how to add security scanning to your synthetic monitoring tests.

## Quick Start

```typescript
import { test } from '../src/monitoring';

test('my security test', async ({ page, monitoring }) => {
  // 1. Navigate and authenticate as needed using normal Playwright commands
  await page.goto('/login');
  await page.fill('#username', 'myuser');
  await page.fill('#password', 'mypass');
  await page.click('[type="submit"]');

  // 2. Navigate to the page/section you want to scan
  await page.goto('/protected-area');

  // 3. Run the security scan
  await monitoring({ 
    securityScan: true,  // Enable security scanning
    isFullScan: false    // true for comprehensive scan, false for quick scan
  });
});
```

## Options

- `securityScan: boolean` - Enable/disable security scanning
- `isFullScan: boolean` - Control scan depth
  - `false` (default) - Quick scan (~15 minutes)
  - `true` - Comprehensive scan (~60 minutes)

## Best Practices

1. **Authentication First**: Always perform authentication before scanning
2. **Target Specific Areas**: Scan specific functional areas rather than entire application
3. **Use Quick Scans**: Use quick scans during development/PR checks
4. **Full Scans Weekly**: Let the weekly scheduled job handle full scans

## Examples

See `examples/security-examples.spec.ts` for more usage examples.