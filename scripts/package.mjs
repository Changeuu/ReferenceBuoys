import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Invalid version');
const name = `reference-buoys-${manifest.version}`;
const dist = path.join(root, 'dist');
const kit = path.join(dist, name);
const plugin = path.join(kit, 'reference-buoys');
await fs.mkdir(plugin, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css']) await fs.copyFile(path.join(root, file), path.join(plugin, file));
for (const file of ['README.md', 'README.zh-CN.md', 'LICENSE']) await fs.copyFile(path.join(root, file), path.join(kit, file));
await fs.cp(path.join(root, 'examples'), path.join(kit, '示例笔记'), { recursive: true });
const zip = path.join(dist, `${name}.zip`);
const entries = {};
async function collect(directory, prefix = '') {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name), name = prefix + entry.name;
    if (entry.isDirectory()) await collect(full, name + '/');
    else entries[name] = new Uint8Array(await fs.readFile(full));
  }
}
await collect(kit);
const data = zipSync(entries, { level: 9 });
const verified = unzipSync(data);
for (const [name, content] of Object.entries(entries)) {
  if (!Buffer.from(content).equals(Buffer.from(verified[name]))) throw new Error(`Archive mismatch: ${name}`);
}
await fs.writeFile(zip, data);
const sha = createHash('sha256').update(data).digest('hex');
await fs.writeFile(path.join(dist, `${name}.sha256`), `${sha}  ${name}.zip\n`);
console.log(`Created ${zip} (${data.length} bytes)\nSHA-256 ${sha}`);
