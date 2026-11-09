import { determinismCorpus } from './determinism.ts';
import { parseArguments } from './arguments.ts';
try { await determinismCorpus(parseArguments(process.argv.slice(2))); process.stdout.write('corpus determinism passed\n'); }
catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
