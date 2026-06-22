const PREFIX = "[desktop:main]";

export const logger = {
  debug: (...args: unknown[]): void => console.debug(PREFIX, ...args),
  info: (...args: unknown[]): void => console.info(PREFIX, ...args),
  warn: (...args: unknown[]): void => console.warn(PREFIX, ...args),
  error: (...args: unknown[]): void => console.error(PREFIX, ...args),
};
