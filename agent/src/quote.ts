/** Join argv into a shell command line with platform-appropriate quoting. */
export function joinCommandLine(argv: string[], platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return argv.map(quoteWindows).join(' ');
  }
  return argv.map(quotePosix).join(' ');
}

function quoteWindows(token: string): string {
  if (token.length > 0 && !/[\s"^&|<>()%!]/.test(token)) return token;
  // cmd.exe: wrap in double quotes, escape embedded quotes by doubling backslashes before them
  return `"${token.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
}

function quotePosix(token: string): string {
  if (token.length > 0 && /^[\w@%+=:,./-]+$/.test(token)) return token;
  return `'${token.replace(/'/g, `'\\''`)}'`;
}
