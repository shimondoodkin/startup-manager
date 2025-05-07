import { createServer } from 'http';
import next from 'next';
import { WebSocketServer } from './lib/WebSocketServer';
import { TerminalServer } from './lib/TerminalServer';
import { parse } from 'url';
import { join } from 'path';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Prepare the Next.js app
app.prepare().then(() => {
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
  
  // Initialize WebSocket servers
  const wsServer = new WebSocketServer(server);
  const terminalServer = new TerminalServer(server);
  
  // Start the server
  server.listen(port, async () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    
    // Initialize the program manager
    await wsServer.initialize();
  });
  
  // Handle shutdown
  const shutdown = () => {
    console.log('Shutting down gracefully...');
    wsServer.shutdown();
    terminalServer.shutdown();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
});
