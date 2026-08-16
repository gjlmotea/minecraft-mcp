#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

import { composeRuntime, readRuntimeConfig } from './composition.js';
import { log } from './logger.js';
import { createMcpServer } from './server/create-server.js';
import { connectStdio } from './transports/stdio.js';

const PACKAGE_URL = new URL('../package.json', import.meta.url);

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(PACKAGE_URL, 'utf8');
    const parsed = JSON.parse(raw) as { readonly version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const version = await readVersion();
  const config = readRuntimeConfig();
  const runtime = composeRuntime(version, config);

  await runtime.connection.start();

  const server = createMcpServer({
    service: runtime.service,
    build: runtime.build,
    version,
  });
  await connectStdio(server);

  const status = runtime.service.status();
  log('info', 'ready', {
    version,
    transport: 'stdio',
    bridge: `${status.host}:${String(status.port)}`,
    connectCommand: status.connectCommand,
    networkAccess: 'loopback-websocket-only',
    filesystemWrites: false,
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    log('info', 'shutting down', { signal });
    await runtime.connection.close();
    await server.close();
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      void shutdown('EPIPE');
      return;
    }
    throw error;
  });
}

main().catch((error: unknown) => {
  log('error', 'fatal', {
    detail: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
