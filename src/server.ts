import { createServer } from 'http';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';
import { WebSocketServer } from './lib/WebSocketServer';
import { TerminalServer } from './lib/TerminalServer';
import { parse } from 'url';
import { join } from 'path';
import { AddressInfo } from 'net';
import logger, { logWithIP } from './lib/logger';
import fs from 'fs';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import config from './lib/config';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
let port = parseInt(process.env.PORT || '3000', 10);



async function start() {
  // Create Next.js app
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  // Prepare the Next.js app
  await app.prepare();

  // Create Express app for middleware
  const expressApp = express();

  // Apply security middleware
  expressApp.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  }));

  // We're only applying rate limiting to WebSocket login attempts
  // See WebSocketServer.ts for implementation

  // Ensure logs directory exists
  if (!fs.existsSync(config.LOG_DIR)) {
    fs.mkdirSync(config.LOG_DIR, { recursive: true });
  }

  // Setup HTTP request logging with Morgan - only log in production if not debug level
  const shouldLogHttp = dev || config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'http';
  if (shouldLogHttp) {
    expressApp.use(morgan('combined', {
      stream: {
        write: (message: string) => {
          // Extract IP address from morgan log
          const ipMatch = message.match(/^(\S+)\s-\s/);
          const ip = ipMatch ? ipMatch[1] : 'unknown';
          // Only log at 'http' level to reduce noise
          logWithIP('http', message.trim(), ip, { category: 'http' });
        }
      }
    }));
  }

  // Create HTTP server
  const server = createServer(async (req, res) => {
    try {
      // Get client IP address - ensure we have a string representation
      let ip = typeof req.headers['x-forwarded-for'] === 'string'
        ? req.headers['x-forwarded-for'].split(',')[0].trim()
        : Array.isArray(req.headers['x-forwarded-for'])
          ? req.headers['x-forwarded-for'][0].trim()
          : req.socket.remoteAddress || 'unknown';

      // Security: Apply express middleware (helmet, rate limiting, etc)
      await new Promise<void>((resolve) => {
        expressApp(req, res); //, resolve
      });

      // Parse URL
      const parsedUrl = parse(req.url!, true);
      const { pathname } = parsedUrl;

      // Generate a unique request ID for tracking
      const requestId = Math.random().toString(36).substring(2, 15);

      // Only log at debug level in production to reduce noise
      if (shouldLogHttp) {
        logWithIP('http', `${req.method} ${pathname}`, ip.toString(), { requestId, category: 'server' });
      }

      // Attach requestId to res for downstream logging
      (res as any).requestId = requestId;
      (req as any).clientIP = ip; // Store client IP for easier access

      // Let Next.js handle the request
      await handle(req, res, parsedUrl);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const errorStack = err instanceof Error ? err.stack : '';
      logger.error('Error occurred handling request:', { error: errorMessage, stack: errorStack, requestId: (res as any).requestId, category: 'server' });
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Create a single Socket.IO server instance
  const io = new SocketIOServer(server, {
    path: '/api/programs/socket.io',
    transports: ['websocket'],
    // Add connection security limits
    connectionStateRecovery: {
      maxDisconnectionDuration: 30000, // 30 seconds
    },
    // Add CORS protection in production
    cors: process.env.NODE_ENV === 'production' ? {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || [process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'],
      methods: ['GET', 'POST']
    } : {}
  });

  // Create namespaces for different services
  const programsNamespace = io.of('/');

  // Initialize WebSocket servers with the namespaces
  const wsServer = new WebSocketServer(programsNamespace);
  await wsServer.initialize();

  // Initialize Terminal server with its namespace
  const terminalServer = new TerminalServer();

  // Connect the terminal server to the websocket server
  wsServer.setTerminalServer(terminalServer);
  terminalServer.setWebSocketServer(wsServer);

  // Try to listen on the current port
  await new Promise<void>((resolve) => { server.listen(port, resolve); });
  const address = server.address() as AddressInfo;
  port = address.port; // Update the port variable with the actual port used
  logger.info(`Server started`, { port, hostname, env: process.env.NODE_ENV });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', { error: err.message, stack: err.stack });
    // if (process.env.NODE_ENV === 'production') {
    //   process.exit(1);
    // }
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', { reason });
    // if (process.env.NODE_ENV === 'production') {
    //   process.exit(1);
    // }
  });

  // Handle shutdown
  let shuttingDown = false;
  process.on('SIGINT', async () => {
    try {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('Shutting down gracefully...');

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
            logger.debug('Closed TTYWrap');
          } catch (e) {
            logger.error('Error closing TTYWrap:', { error: e });
          }
        }
      }

      handles = getActiveHandles();
      // First unref all handles
      for (const handle of handles) {
        try {
          handle.unref();
        } catch (e: any) {
          logger.error('Error unref handle:', { error: e?.stack || JSON.stringify(e) });
        }
      }
      process.exit(0);

    } catch (e: any) {
      logger.error('Error shutting down server:', { error: e.stack });
      process.exit(1);
    }
  });
}

start();
