import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function processSecrets() {
  const args = process.argv.slice(2);
  const options = {
    secretsFile: args.find(arg => arg.startsWith('--secrets-file='))?.split('=')[1],
    authFile: args.find(arg => arg.startsWith('--auth-file='))?.split('=')[1],
    output: args.find(arg => arg.startsWith('--output='))?.split('=')[1],
  };

  let envContent = '';

  // Process secrets file
  if (options.secretsFile) {
    try {
      const secretsContent = await fs.readFile(options.secretsFile, 'utf-8');
      const secrets = JSON.parse(secretsContent);
      
      for (const [key, value] of Object.entries(secrets)) {
        envContent += `${key}=${value}\n`;
      }
    } catch (error) {
      console.warn(`Warning: Could not process secrets file: ${error.message}`);
    }
  }

  // Process auth file
  if (options.authFile) {
    try {
      const authContent = await fs.readFile(options.authFile, 'utf-8');
      const auth = JSON.parse(authContent);
      
      // Store auth configuration
      envContent += `AUTH_CONFIG=${JSON.stringify(auth)}\n`;
    } catch (error) {
      console.warn(`Warning: Could not process auth file: ${error.message}`);
    }
  }

  // Write to output file
  if (options.output && envContent) {
    await fs.writeFile(options.output, envContent, 'utf-8');
    console.log(`Successfully wrote secrets to ${options.output}`);
  }
}

processSecrets().catch(console.error);