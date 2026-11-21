import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const entryFile = path.join(rootDir, 'server/src/worker.js');
const outFile = path.join(rootDir, 'dist/_worker.js');

const builtins = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

const cfNodeBuiltinsPlugin = {
  name: 'cf-node-builtins',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.path.startsWith('node:') || args.path.startsWith('cloudflare:')) {
        return { path: args.path, external: true };
      }
      if (builtins.has(args.path)) {
        return { path: `node:${args.path}`, external: true };
      }
      return undefined;
    });
  },
};

fs.mkdirSync(path.dirname(outFile), { recursive: true });

await esbuild.build({
  entryPoints: [entryFile],
  outfile: outFile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'esnext',
  mainFields: ['module', 'main'],
  nodePaths: [path.join(rootDir, 'node_modules')],
  plugins: [cfNodeBuiltinsPlugin],
  banner: {
    js: "import { createRequire as __cfCreateRequire } from 'node:module'; const require = __cfCreateRequire(import.meta.url);",
  },
  minify: true,
});

const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`Built Cloudflare Pages Worker: dist/_worker.js (${sizeKb} KB)`);
