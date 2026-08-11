export function parsePort(argv) {
  const flagIndex = argv.indexOf("--port");
  if (flagIndex === -1) return 49786;

  const port = Number.parseInt(argv[flagIndex + 1] ?? "", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("--port must be an integer between 1 and 65535");
  }
  return port;
}
