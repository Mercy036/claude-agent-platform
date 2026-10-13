import { build } from 'esbuild';

// Bundle the workspace protocol so the published CLI has no private-workspace
// runtime dependency. Terminal UI packages remain normal npm dependencies.
await build({
  entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true,
  platform: 'node', target: 'node20', format: 'esm', sourcemap: true,
  external: ['commander', 'inquirer', 'chalk'],
});
