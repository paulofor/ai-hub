type LogLevel = 'info' | 'warn' | 'error' | 'log';

export function logWithTimestamp(level: LogLevel, message: string, ...metadata: unknown[]): void {
  const timestamp = new Date().toISOString();
  const formatted = message.startsWith('[') ? message : `[${timestamp}] ${message}`;

  switch (level) {
    case 'warn':
      console.warn(formatted, ...metadata);
      break;
    case 'error':
      console.error(formatted, ...metadata);
      break;
    case 'log':
      console.log(formatted, ...metadata);
      break;
    default:
      console.info(formatted, ...metadata);
  }
}
