#!/usr/bin/env node
// Version gate for the dsh-zcf bin. The ESM bundle imports dependencies that
// only exist on modern Node (@clack/core uses util.styleText added in 20.12;
// commander 15 declares >=22.12), and an ESM entry cannot guard itself — its
// static imports run before any statement — so this CommonJS launcher checks
// the runtime version first and only then imports the wizard.
const MIN = [22, 12]
const parts = process.versions.node.split('.').map(Number)
const satisfied = parts[0] > MIN[0] || (parts[0] === MIN[0] && parts[1] >= MIN[1])
if (!satisfied) {
  console.error(`dsh-zcf 需要 Node.js >= ${MIN[0]}.${MIN[1]}（当前 ${process.versions.node}）。`)
  console.error(`dsh-zcf requires Node.js >= ${MIN[0]}.${MIN[1]} (current ${process.versions.node}).`)
  console.error('升级 / upgrade: nvm install 22 && nvm use 22, or https://github.com/nodesource/distributions')
  process.exit(1)
}
// Two more bin names over this same launcher: `dsh-tui` (the primary) and
// `dzcf-tui` (an alias that stays available when a foreign package owns the
// dsh-tui name) start the default profile's terminal UI without any
// subcommand typing.
const launcher = process.argv[1] ?? ''
if ((launcher.endsWith('dsh-tui') || launcher.endsWith('dzcf-tui')) && !process.argv.slice(2).includes('tui')) {
  process.argv.splice(2, 0, 'tui')
}
import('./bin.js')
