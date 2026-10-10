#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const inquirer_1 = __importDefault(require("inquirer"));
const chalk_1 = __importDefault(require("chalk"));
const axios_1 = __importDefault(require("axios"));
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
        // Single request: POST returns SSE stream directly
        const https = await Promise.resolve().then(() => __importStar(require('https')));
        const http = await Promise.resolve().then(() => __importStar(require('http')));
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
        const req = transport.request(options, (res) => {
            let buffer = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                buffer += chunk;
                const parts = buffer.split('\n\n');
                buffer = parts.pop() ?? '';
                for (const part of parts) {
                    const line = part.trim();
                    if (!line || line.startsWith(':'))
                        continue; // skip keepalives
                    if (line.startsWith('data: ')) {
                        try {
                            const parsed = JSON.parse(line.slice(6));
                            const { event, data } = parsed;
                            if (event === 'LOG') {
                                console.log(chalk_1.default.cyan(`\n[Agent] ${data.message}`));
                            }
                            else if (event === 'DELTA') {
                                process.stdout.write(chalk_1.default.white(data.text));
                                agentResponse += data.text;
                            }
                            else if (event === 'COMPLETED') {
                                console.log(chalk_1.default.green('\n\n✓ Task completed successfully.'));
                                const fileRegex = /<<<FILE:\s*(.+?)>>>\n([\s\S]*?)<<<ENDFILE>>>/g;
                                let match;
                                let filesCreated = 0;
                                while ((match = fileRegex.exec(agentResponse)) !== null) {
                                    const filePath = path_1.default.join(process.cwd(), match[1].trim());
                                    const fileContent = match[2];
                                    const dir = path_1.default.dirname(filePath);
                                    if (!fs_1.default.existsSync(dir))
                                        fs_1.default.mkdirSync(dir, { recursive: true });
                                    fs_1.default.writeFileSync(filePath, fileContent.trim() + '\n');
                                    console.log(chalk_1.default.green(`✓ Wrote file: ${match[1].trim()}`));
                                    filesCreated++;
                                }
                                if (filesCreated > 0) {
                                    console.log(chalk_1.default.blue(`\nSuccessfully created/modified ${filesCreated} files!`));
                                }
                                process.exit(0);
                            }
                            else if (event === 'FAILED') {
                                console.error(chalk_1.default.red(`\n✗ Task failed: ${data.error}`));
                                process.exit(1);
                            }
                        }
                        catch { }
                    }
                }
            });
            res.on('end', () => process.exit(0));
            res.on('error', (e) => {
                console.error(chalk_1.default.red('Stream error: ' + e.message));
                process.exit(1);
            });
        });
        req.on('error', (e) => {
            console.error(chalk_1.default.red('Connection error: ' + e.message));
            process.exit(1);
        });
        req.write(body);
        req.end();
        process.on('SIGINT', () => {
            console.log(chalk_1.default.yellow('\nCancelling...'));
            req.destroy();
            process.exit(0);
        });
    }
    catch (error) {
        console.error(chalk_1.default.red('Error:'), error.response?.data?.error || error.message);
    }
});
program.parse(process.argv);
