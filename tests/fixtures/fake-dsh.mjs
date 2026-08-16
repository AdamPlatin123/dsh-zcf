#!/usr/bin/env node
/**
 * Fixture `dsh` for dsh-zcf snapshot tests: a hermetic PATH shim that answers
 * the invocations the wizard makes — the `-V` probe, the surface-bundle
 * registration (`plugin --profile <name> add -w <bundle>`), and the
 * `--profile <name> --dump[-default]-config` verification — without needing a
 * real installation. Any other invocation fails, so a wizard that starts
 * depending on new dsh surfaces fails this fixture instead of passing
 * silently.
 */
const args = process.argv.slice(2)

if (args.length === 1 && args[0] === '-V') {
  console.log('0.0.1-rc.2 (fixture)')
  process.exit(0)
}
if (args.length === 6 && args[0] === 'plugin' && args[1] === '--profile' && args[3] === 'add' && args[4] === '-w') {
  console.log(`+ ${args[5]}`)
  process.exit(0)
}
if (args.length === 3 && args[0] === '--profile' && (args[2] === '--dump-default-config' || args[2] === '--dump-config')) {
  console.log(`# fixture: ${args[1]} profile composed`)
  console.log('- id: fixture-row')
  console.log('  name: "@deepseek-ai/fixture"')
  process.exit(0)
}
console.error(`fake-dsh: unexpected invocation ${JSON.stringify(args)}`)
process.exit(1)
