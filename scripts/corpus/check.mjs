import { checkCorpus } from './core.ts';
import { parseArguments } from './arguments.ts';
try {
  const { root } = parseArguments(process.argv.slice(2), ['--root']);
  const errors = checkCorpus(root);
  if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exitCode = 1; }
  else process.stdout.write('corpus check passed\n');
} catch (error) { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; }
