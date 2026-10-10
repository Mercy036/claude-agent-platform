#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import axios from 'axios';
import EventSource from 'eventsource';
import fs from 'fs';
import path from 'path';
import os from 'os';

const program = new Command();
const API_URL = process.env.HACKATHON_API_URL || 'http://localhost:3001';

const CONFIG_DIR = path.join(os.homedir(), '.hackathon-luna');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function saveConfig(config: any) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  }
  return null;
}

program
  .name('hackathon-luna')
  .description('CLI to interact with the GPT-6 Luna Hackathon agent')
  .version('1.0.0');

program
  .command('login')
  .description('Login to the platform')
  .action(async () => {
    const answers = await inquirer.prompt([
      { type: 'input', name: 'email', message: 'Email:' },
      { type: 'password', name: 'password', message: 'Password:' }
    ]);

    try {
      const response = await axios.post(`${API_URL}/api/auth/login`, answers);
      saveConfig({ token: response.data.token, user: response.data.user });
      console.log(chalk.green('✓ Login successful'));
    } catch (error: any) {
      console.error(chalk.red('Login failed.'), error.response?.data?.error || error.message);
    }
  });

program
  .command('logout')
  .description('Logout of the platform')
  .action(() => {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
    console.log(chalk.green('✓ Logged out successfully'));
  });

program
  .command('status')
  .description('Check usage status')
  .action(async () => {
    const config = loadConfig();
    if (!config?.token) {
      console.error(chalk.red('Not logged in. Run: hackathon-luna login'));
      return;
    }

    try {
      const response = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${config.token}` }
      });
      const user = response.data.user;
      console.log(chalk.blue(`Usage: ${user.tokensUsed.toLocaleString()} / ${user.tokenLimit.toLocaleString()} tokens`));
      console.log(chalk.green(`Remaining: ${(user.tokenLimit - user.tokensUsed).toLocaleString()}`));
    } catch (error: any) {
      console.error(chalk.red('Failed to fetch status:'), error.response?.data?.error || error.message);
    }
  });

program
  .description('Start a new agent task')
  .action(async () => {
    const config = loadConfig();
    if (!config?.token) {
      console.error(chalk.red('Not logged in. Run: hackathon-luna login'));
      return;
    }

    try {
      // Fetch initial status
      const meResponse = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${config.token}` }
      });
      const user = meResponse.data.user;
      
      console.log(chalk.bold('GPT-6 Luna Hackathon'));
      console.log(`Logged in as: ${chalk.blue(user.email)}`);
      console.log(chalk.blue(`Usage: ${user.tokensUsed.toLocaleString()} / ${user.tokenLimit.toLocaleString()} tokens\n`));
      
      const { task } = await inquirer.prompt([
        { type: 'input', name: 'task', message: 'What would you like GPT-6 Luna to do?' }
      ]);
      
      console.log(chalk.yellow('\nStarting agent...'));

      // Single request: POST returns SSE stream directly
      const https = await import('https');
      const http = await import('http');
      const url = new URL(`${API_URL}/api/agent/run`);
      const body = JSON.stringify({ task, cwd: process.cwd() });

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'text/event-stream',
        }
      };

      let agentResponse = '';

      const transport = url.protocol === 'https:' ? https : http;
      const req = (transport as any).request(options, (res: any) => {
        let buffer = '';
        res.setEncoding('utf8');

        res.on('data', (chunk: string) => {
          buffer += chunk;
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.trim();
            if (!line || line.startsWith(':')) continue; // skip keepalives
            if (line.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(line.slice(6));
                const { event, data } = parsed;

                if (event === 'LOG') {
                  console.log(chalk.cyan(`\n[Agent] ${data.message}`));
                } else if (event === 'DELTA') {
                  process.stdout.write(chalk.white(data.text));
                  agentResponse += data.text;
                } else if (event === 'COMPLETED') {
                  console.log(chalk.green('\n\n✓ Task completed successfully.'));

                  const fileRegex = /<<<FILE:\s*(.+?)>>>\n([\s\S]*?)<<<ENDFILE>>>/g;
                  let match;
                  let filesCreated = 0;
                  while ((match = fileRegex.exec(agentResponse)) !== null) {
                    const filePath = path.join(process.cwd(), match[1].trim());
                    const fileContent = match[2];
                    const dir = path.dirname(filePath);
                    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(filePath, fileContent.trim() + '\n');
                    console.log(chalk.green(`✓ Wrote file: ${match[1].trim()}`));
                    filesCreated++;
                  }
                  if (filesCreated > 0) {
                    console.log(chalk.blue(`\nSuccessfully created/modified ${filesCreated} files!`));
                  }
                  process.exit(0);
                } else if (event === 'FAILED') {
                  console.error(chalk.red(`\n✗ Task failed: ${data.error}`));
                  process.exit(1);
                }
              } catch {}
            }
          }
        });

        res.on('end', () => process.exit(0));
        res.on('error', (e: Error) => {
          console.error(chalk.red('Stream error: ' + e.message));
          process.exit(1);
        });
      });

      req.on('error', (e: Error) => {
        console.error(chalk.red('Connection error: ' + e.message));
        process.exit(1);
      });

      req.write(body);
      req.end();

      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nCancelling...'));
        req.destroy();
        process.exit(0);
      });

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
    }
  });

program.parse(process.argv);
