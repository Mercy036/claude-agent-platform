const path = require('node:path');
const { spawn } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const child = spawn(process.execPath, [require.resolve('prisma/build/index.js'), ...process.argv.slice(2)], {
  cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit', windowsHide: true,
});
child.once('error', error => { console.error(error.message); process.exitCode = 1; });
child.once('exit', code => { process.exitCode = code ?? 1; });
