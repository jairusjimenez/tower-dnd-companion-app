import { buildApp } from './app';

async function main(): Promise<void> {
  const { app, config } = await buildApp();

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
  console.log(`Tower System VTT server running at http://localhost:${config.port}`);
}

main().catch((err) => {
  console.error('Failed to start Tower System VTT server:', err);
  process.exit(1);
});
