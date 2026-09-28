#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const axios_1 = __importDefault(require("axios"));
const eventsource_1 = __importDefault(require("eventsource"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const program = new commander_1.Command();
const API_URL = process.env.HACKATHON_API_URL || 'http://localhost:3001';
const CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.hackathon-claude');
const CONFIG_FILE = path_1.default.join(CONFIG_DIR, 'config.json');
function saveConfig(config) {
    if (!fs_1.default.existsSync(CONFIG_DIR)) {
        fs_1.default.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
function loadConfig() {
    if (fs_1.default.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs_1.default.readFileSync(CONFIG_FILE, 'utf-8'));
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
    const answers = await inquirer_1.default.prompt([
        { type: 'input', name: 'email', message: 'Email:' },
        { type: 'password', name: 'password', message: 'Password:' }
    ]);
    try {
        const response = await axios_1.default.post(`${API_URL}/api/auth/login`, answers);
        saveConfig({ token: response.data.token, user: response.data.user });
        console.log(chalk_1.default.green('✓ Login successful'));
    }
    catch (error) {
        console.error(chalk_1.default.red('Login failed.'), error.response?.data?.error || error.message);
    }
});
program
    .command('logout')
    .description('Logout of the platform')
    .action(() => {
    if (fs_1.default.existsSync(CONFIG_FILE)) {
        fs_1.default.unlinkSync(CONFIG_FILE);
    }
    console.log(chalk_1.default.green('✓ Logged out successfully'));
});
program
    .command('status')
    .description('Check usage status')
    .action(async () => {
    const config = loadConfig();
    if (!config?.token) {
        console.error(chalk_1.default.red('Not logged in. Run: hackathon-claude login'));
        return;
    }
    try {
        const response = await axios_1.default.get(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        const user = response.data.user;
        console.log(chalk_1.default.blue(`Usage: ${user.tokensUsed.toLocaleString()} / ${user.tokenLimit.toLocaleString()} tokens`));
        console.log(chalk_1.default.green(`Remaining: ${(user.tokenLimit - user.tokensUsed).toLocaleString()}`));
    }
    catch (error) {
        console.error(chalk_1.default.red('Failed to fetch status:'), error.response?.data?.error || error.message);
    }
});
program
    .description('Start a new agent task')
    .action(async () => {
    const config = loadConfig();
    if (!config?.token) {
        console.error(chalk_1.default.red('Not logged in. Run: hackathon-claude login'));
        return;
    }
    try {
        // Fetch initial status
        const meResponse = await axios_1.default.get(`${API_URL}/api/auth/me`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        const user = meResponse.data.user;
        console.log(chalk_1.default.bold('Claude Hackathon'));
        console.log(`Logged in as: ${chalk_1.default.blue(user.email)}`);
        console.log(chalk_1.default.blue(`Usage: ${user.tokensUsed.toLocaleString()} / ${user.tokenLimit.toLocaleString()} tokens\n`));
        const { task } = await inquirer_1.default.prompt([
            { type: 'input', name: 'task', message: 'What would you like Claude to do?' }
        ]);
        console.log(chalk_1.default.yellow('\nStarting agent...'));
        const sessionResponse = await axios_1.default.post(`${API_URL}/api/agent/session`, { task, cwd: process.cwd() }, { headers: { Authorization: `Bearer ${config.token}` } });
        const sessionId = sessionResponse.data.sessionId;
        const es = new eventsource_1.default(`${API_URL}/api/agent/stream/${sessionId}`, {
            headers: { Authorization: `Bearer ${config.token}` }
        });
        es.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.event === 'LOG') {
                console.log(chalk_1.default.cyan(`[Agent] ${data.data.message}`));
            }
            else if (data.event === 'COMPLETED') {
                console.log(chalk_1.default.green('\n✓ Task completed successfully.'));
                es.close();
                process.exit(0);
            }
            else if (data.event === 'FAILED') {
                console.error(chalk_1.default.red(`\n✗ Task failed: ${data.data.error}`));
                es.close();
                process.exit(1);
            }
            else if (data.event === 'CANCELLED') {
                console.log(chalk_1.default.yellow('\nTask was cancelled.'));
                es.close();
                process.exit(0);
            }
        };
        es.onerror = (err) => {
            console.error(chalk_1.default.red('Connection to agent lost.'));
            es.close();
            process.exit(1);
        };
        // Handle graceful exit
        process.on('SIGINT', () => {
            console.log(chalk_1.default.yellow('\nCancelling task...'));
            // In a real implementation, we would send a DELETE/CANCEL request to the backend
            es.close();
            process.exit(0);
        });
    }
    catch (error) {
        console.error(chalk_1.default.red('Error:'), error.response?.data?.error || error.message);
    }
});
program.parse(process.argv);
//# sourceMappingURL=index.js.map