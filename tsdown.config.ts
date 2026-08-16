import { defineConfig } from 'tsdown'

/**
 * One entry: the `bin` referenced by package.json. tsdown compiles the TS
 * sources directly, so no tsc intermediate output is needed. The two
 * @deepseek-ai workspace utilities are bundled in (`noExternal`), so the
 * published tarball is self-contained: an `npx dsh-zcf` run resolves only
 * public npm packages and never the private scope.
 */
export default defineConfig({
  entry: ['src/bin.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: true,
  noExternal: ['@deepseek-ai/dsh-home-paths', '@deepseek-ai/dsh-atomic-write'],
})
