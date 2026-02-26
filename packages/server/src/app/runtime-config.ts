let runtimePort = parseInt(process.env.PORT || "0", 10) || 0;

export function setRuntimePort(port: number): void {
  runtimePort = port;
}

export function getRuntimeBaseUrl(): string {
  return `http://127.0.0.1:${runtimePort}`;
}
