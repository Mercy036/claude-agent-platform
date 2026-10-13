#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import { collectContext, listProjectFiles, parseFileEdits, validateEdits, applyEdits } from './files.js';
import { consumeResponse } from './stream.js';

const API_URL = (process.env.HACKATHON_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const url = new URL(API_URL);
if (!['http:', 'https:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
  throw new Error('Use HTTPS for remote API connections');
}
const CONFIG_DIR = path.join(os.homedir(), '.hackathon-claude');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
type Config = { token: string; apiUrl: string };
function saveConfig(config: Config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(CONFIG_DIR).isSymbolicLink() || (fs.existsSync(CONFIG_FILE) && fs.lstatSync(CONFIG_FILE).isSymbolicLink())) throw new Error('Unsafe configuration path');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config), { mode: 0o600 });
  fs.chmodSync(CONFIG_FILE, 0o600);
}
function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_FILE)) throw new Error('Run hackathon-claude login first');
  if (fs.lstatSync(CONFIG_DIR).isSymbolicLink() || fs.lstatSync(CONFIG_FILE).isSymbolicLink()) throw new Error('Unsafe configuration path');
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (typeof config.token !== 'string' || config.apiUrl !== API_URL) throw new Error('Log in again for this API address');
  return config;
}
async function api(route: string, token?: string, body?: unknown) {
  const response = await fetch(`${API_URL}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function reportUsage(data: { user: { tokensUsed: number; tokenLimit: number; tokensReserved: number }; teamQuota?: { tokensUsed: number; tokenLimit: number; tokensReserved: number } }) {
  console.log(`Usage: ${data.user.tokensUsed.toLocaleString()} / ${data.user.tokenLimit.toLocaleString()} tokens; ${data.user.tokensReserved.toLocaleString()} reserved`);
  if (data.teamQuota) console.log(`Shared team usage: ${data.teamQuota.tokensUsed.toLocaleString()} / ${data.teamQuota.tokenLimit.toLocaleString()}; ${data.teamQuota.tokensReserved.toLocaleString()} reserved`);
}

const program = new Command().name('hackathon-claude').description('Claude hackathon coding assistant').version('1.1.0');
program.command('login').description('Log in to the platform').action(async () => {
  const credentials = await inquirer.prompt([{ type: 'input', name: 'email', message: 'Email:' }, { type: 'password', name: 'password', message: 'Password:' }]);
  const data = await api('/api/auth/login', undefined, credentials);
  saveConfig({ token: data.token, apiUrl: API_URL });
  console.log(chalk.green('Login successful'));
});
program.command('logout').description('Remove saved authentication').action(() => {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
  console.log('Logged out');
});
program.command('status').description('Check personal and team usage').action(async () => {
  reportUsage(await api('/api/auth/me', loadConfig().token));
});
program.action(async () => {
  const config = loadConfig();
  const me = await api('/api/auth/me', config.token);
  console.log(chalk.bold(`Claude Hackathon — ${me.user.email}`));
  reportUsage(me);
  const { task } = await inquirer.prompt([{ type: 'input', name: 'task', message: 'What should Claude do?', validate: (value: string) => value.trim().length > 0 || 'Enter a task' }]);
  const root = fs.realpathSync(process.cwd());
  const candidates = listProjectFiles(root);
  const { paths } = candidates.length ? await inquirer.prompt([{
    type: 'checkbox', name: 'paths', message: 'Select project files to share with the server and Anthropic (space selects; none are selected by default):', choices: candidates,
  }]) : { paths: [] };
  const files = collectContext(root, paths);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  const timeout = setTimeout(cancel, 60 * 60 * 1000);
  let output = '';
  try {
    const response = await fetch(`${API_URL}/api/agent/run`, {
      method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ task, files }), signal: controller.signal,
    });
    await consumeResponse(response, ({ event, data }) => {
      if (event === 'DELTA') {
        if (typeof data.text !== 'string') throw new Error('Invalid text delta');
        output += data.text;
        if (output.length > 1024 * 1024) throw new Error('Response is too large');
        process.stdout.write(stripVTControlCharacters(data.text).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''));
      } else if (event === 'QUEUED') console.log(chalk.yellow('Task queued'));
      else if (event === 'LOG') console.log(chalk.cyan(String(data.message)));
    });
  } finally { clearTimeout(timeout); process.off('SIGINT', cancel); }
  const edits = parseFileEdits(output);
  validateEdits(root, edits, files);
  console.log(chalk.green('\nGeneration completed'));
  if (!edits.length) return;
  console.log('\nProposed file changes:');
  for (const edit of edits) console.log(`  ${fs.existsSync(path.join(root, edit.path)) ? 'Modify' : 'Create'} ${edit.path}`);
  const { apply } = await inquirer.prompt([{ type: 'confirm', name: 'apply', message: 'Apply these file changes shown above?', default: false }]);
  if (!apply) { console.log('Changes were not applied'); return; }
  const backups = applyEdits(root, edits, files);
  console.log(chalk.green(`Applied ${edits.length} file changes`));
  for (const backup of backups) console.log(`Original saved at: ${path.relative(root, backup)}`);
});
program.parseAsync(process.argv).catch(error => { console.error(chalk.red(error.message)); process.exitCode = 1; });
