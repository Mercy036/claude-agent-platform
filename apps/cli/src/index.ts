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

const CONFIG_DIR = path.join(os.homedir(), '.hackathon-claude');
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
  .name('hackathon-claude')
  .description('CLI to interact with the Claude Hackathon agent')
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
      console.error(chalk.red('Not logged in. Run: hackathon-claude login'));
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
      console.error(chalk.red('Not logged in. Run: hackathon-claude login'));
      return;
    }

    try {
      // Fetch initial status
      const meResponse = await axios.get(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${config.token}` }
      });
      const user = meResponse.data.user;
      
      console.log(chalk.bold('Claude Hackathon'));
      console.log(`Logged in as: ${chalk.blue(user.email)}`);
      console.log(chalk.blue(`Usage: ${user.tokensUsed.toLocaleString()} / ${user.tokenLimit.toLocaleString()} tokens\n`));
      
      const { task } = await inquirer.prompt([
        { type: 'input', name: 'task', message: 'What would you like Claude to do?' }
      ]);
      
      console.log(chalk.yellow('\nStarting agent...'));

      const sessionResponse = await axios.post(`${API_URL}/api/agent/session`, 
        { task, cwd: process.cwd() },
        { headers: { Authorization: `Bearer ${config.token}` } }
      );

      const sessionId = sessionResponse.data.sessionId;

      const es = new EventSource(`${API_URL}/api/agent/stream/${sessionId}`, {
        headers: { Authorization: `Bearer ${config.token}` }
      });

      es.onmessage = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.event === 'LOG') {
          console.log(chalk.cyan(`[Agent] ${data.data.message}`));
        } else if (data.event === 'COMPLETED') {
          console.log(chalk.green('\n✓ Task completed successfully.'));
          es.close();
          process.exit(0);
        } else if (data.event === 'FAILED') {
          console.error(chalk.red(`\n✗ Task failed: ${data.data.error}`));
          es.close();
          process.exit(1);
        } else if (data.event === 'CANCELLED') {
          console.log(chalk.yellow('\nTask was cancelled.'));
          es.close();
          process.exit(0);
        }
      };

      es.onerror = (err: Event) => {
        console.error(chalk.red('Connection to agent lost.'));
        es.close();
        process.exit(1);
      };

      // Handle graceful exit
      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nCancelling task...'));
        // In a real implementation, we would send a DELETE/CANCEL request to the backend
        es.close();
        process.exit(0);
      });

    } catch (error: any) {
      console.error(chalk.red('Error:'), error.response?.data?.error || error.message);
    }
  });

program.parse(process.argv);
