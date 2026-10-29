// Stands in for the `cargo` process only: prints the libtest text in fake-cargo/ and exits with its code.
import { existsSync, readFileSync } from "node:fs";
const read = (name) => (existsSync(`fake-cargo/${name}`) ? readFileSync(`fake-cargo/${name}`, "utf8") : "");
process.stderr.write(read("stderr.txt"));
process.stdout.write(read("stdout.txt"));
process.exitCode = Number(read("code").trim() || "0");
