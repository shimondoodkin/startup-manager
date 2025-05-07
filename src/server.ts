import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { WebSocketServer } from './lib/WebSocketServer';
import { TerminalServer } from './lib/TerminalServer';
import { parse } from 'url';
import { join } from 'path';
import { AddressInfo } from 'net';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
let port = parseInt(process.env.PORT || '3000', 10);



async function start() {


  // Create Next.js app
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  // Prepare the Next.js app
  await app.prepare();


  // Create HTTP server
  const server = createServer(async (req, res) => {
    try {
      // Parse URL
      const parsedUrl = parse(req.url!, true);
      const { pathname } = parsedUrl;

      // Let Next.js handle the request
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Create a single Socket.IO server instance
  const io = new SocketIOServer(server, {
    path: '/api/programs/socket.io'
  });

  // Create namespaces for different services
  const programsNamespace = io.of('/');
  const terminalNamespace = io.of('/terminal');

  // Initialize WebSocket servers with the namespaces
  const wsServer = new WebSocketServer(programsNamespace);
  await wsServer.initialize();

  // Store the WebSocket server instance globally for token validation
  (global as any).WebSocketServerInstance = wsServer;

  // Initialize Terminal server with its namespace
  const terminalServer = new TerminalServer(terminalNamespace);

  // Try to listen on the current port
  await new Promise<void>((resolve) => { server.listen(port, resolve); });
  const address = server.address() as AddressInfo;
  port = address.port; // Update the port variable with the actual port used
  console.log(`> Ready on http://${hostname}:${port}`);

  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    // process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    // process.exit(1);
  });

  // Handle shutdown
  let shuttingDown = false;
  process.on('SIGINT', async () => {
    try {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log('Shutting down gracefully...');

      // Close all file watchers
      const getActiveHandles = (process as any)._getActiveHandles as () => any[];
      await terminalServer.shutdown();
      wsServer.shutdown();
      io.close();
      server.close();
      await app.close()

      let handles = getActiveHandles();

      // First close all tty handles
      for (const handle of handles) {
        if (handle.constructor.name === 'TTYWrap' && typeof handle.close === 'function') {
          try {
            handle.close();
            console.log('Closed TTYWrap');
          } catch (e) {
            console.error('Error closing TTYWrap:', e);
          }
        }
      }

      handles = getActiveHandles();
      // First unref all handles
      for (const handle of handles) {
        try {
          handle.unref();
        } catch (e: any) {
          console.error('Error unref handle:', e?.stack || JSON.stringify(e));
        }
      }
      process.exit(0);

    } catch (e: any) {
      console.error('Error shutting down server:', e.stack);
      process.exit(1);
    }
  });

}

start();
