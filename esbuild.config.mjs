import esbuild from 'esbuild';
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  format: 'cjs',
  target: 'es2022',
  platform: 'browser',
  outfile: 'main.js',
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  banner: { js: '/* Reference Buoys | MIT License | Source: src/ */' },
  logLevel: 'info'
};
if (process.argv.includes('--watch')) {
  const context = await esbuild.context(options);
  await context.watch();
} else await esbuild.build(options);
