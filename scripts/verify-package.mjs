import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const required = ['package.json', 'cordis.patch.yml', 'README.md', 'LICENSE'];
const errors = [];

for (const file of required) {
  try {
    if (!statSync(join(root, file)).isFile()) errors.push(`missing file: ${file}`);
  } catch {
    errors.push(`missing file: ${file}`);
  }
}

const files = new Set();
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.add(relative(root, full).split('\\').join('/'));
  }
}
walk(join(root, 'lib'));

for (const file of files) {
  if (/\.(bak|log|tmp)$|\.bak-/.test(file)) errors.push(`forbidden file in lib: ${file}`);
}

const bytes = [...files].reduce((sum, file) => sum + statSync(join(root, file)).size, 0);
if (!pkg.name || !pkg.version) errors.push('package.json missing name/version');
if (!Array.isArray(pkg.files) || !pkg.files.includes('lib')) errors.push('package.json files must include lib');
if (!/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(String(pkg.version))) errors.push(`invalid version ${pkg.version}`);

console.log(`package ${pkg.name}@${pkg.version}`);
console.log(`lib files: ${files.size}, ${(bytes / 1024).toFixed(1)} KB`);
for (const file of [...files].sort()) console.log(`  ${file}`);
if (errors.length) {
  console.error('\nERRORS:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}
console.log('\npackage contents OK');
