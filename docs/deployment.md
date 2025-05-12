# Startup Manager Deployment Guide

## Overview

This guide covers the steps needed to deploy the Startup Manager application in a production environment.

## Prerequisites

- Node.js >= 18.x
- npm >= 9.x
- Access to a server or hosting platform
- (Optional) Docker for containerized deployment

## Environment Setup

### Step 1: Clone the Repository

```bash
git clone https://github.com/your-org/startup-manager.git
cd startup-manager
```

### Step 2: Install Dependencies

```bash
npm install --production
```

### Step 3: Create Environment Configuration

Create a `.env` file in the root directory with the following variables (adjust as needed):

```bash
# Server configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Security configuration
ADMIN_USERNAME=your-admin-username
ADMIN_PASSWORD=your-strong-password
ALLOWED_ORIGINS=https://yourdomain.com
RATE_LIMIT_WINDOW_MINUTES=15
RATE_LIMIT_MAX_REQUESTS=5

# Logging configuration
LOG_LEVEL=info
LOG_TO_FILE=true
LOG_DIR=/var/log/startup-manager
# Log rotation settings (size-based and time-based rotation)
LOG_ROTATE_MAX_SIZE=10m
LOG_ROTATE_MAX_FILES=7d

# Program configuration
CONFIG_PATH=/opt/startup-manager/programs.json
```

## Building the Application

### Step 1: Build the Next.js Frontend

```bash
npm run build
```

### Step 2: Build the Server

```bash
npm run build:server
```

## Running in Production

### Option 1: Direct Node.js Execution

```bash
npm run start:prod
```

### Option 2: Process Manager (Recommended)

Install PM2:

```bash
npm install -g pm2
```

Create a PM2 ecosystem file (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [{
    name: 'startup-manager',
    script: 'dist/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

Start with PM2:

```bash
pm2 start ecosystem.config.js
```

### Option 3: Docker Deployment

A Dockerfile is included in the repository. Build and run with:

```bash
docker build -t startup-manager .
docker run -d -p 3000:3000 --name startup-manager startup-manager
```

## Reverse Proxy Configuration (Recommended)

### Nginx Example

```nginx
server {
  listen 80;
  server_name yourdomain.com;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl http2;
  server_name yourdomain.com;

  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;
  # Additional SSL settings here

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```

## Post-Deployment Verification

1. Verify the application can be accessed at your domain
2. Confirm login functionality works
3. Test program management features
4. Check that terminal functionality works if enabled

## Backup and Maintenance

- Regularly backup the program configuration file
- The application handles log rotation automatically based on the configured settings (LOG_ROTATE_MAX_SIZE and LOG_ROTATE_MAX_FILES)
- Monitor the server resource usage
- Keep the application updated with security patches

## Logging and Log Rotation

The Startup Manager uses Winston for logging with automatic log rotation capabilities:

### Log Configuration

- **LOG_LEVEL**: Sets the verbosity of logs (`error`, `warn`, `info`, `http`, `debug`)
- **LOG_TO_FILE**: Enables writing logs to files when set to `true`
- **LOG_DIR**: Directory where log files will be stored
- **LOG_ROTATE_MAX_SIZE**: Maximum size of each log file before rotation (e.g., `10m`, `1g`)
- **LOG_ROTATE_MAX_FILES**: Maximum retention period or number of files to keep (e.g., `7d` for 7 days, `10` for 10 files)

### Log Files

When file logging is enabled, the application generates two types of log files:

1. **Error logs**: `error-YYYY-MM-DD.log` - Contains only error level messages
2. **Combined logs**: `combined-YYYY-MM-DD.log` - Contains all log messages based on the configured level

Log files are automatically rotated when they reach the configured maximum size. Old log files are compressed and archived with a datestamp in the filename.

### Production Considerations

- For production deployments, it's recommended to set `LOG_TO_FILE=true`
- Ensure the configured `LOG_DIR` has sufficient disk space
- For high-traffic installations, consider adjusting `LOG_ROTATE_MAX_SIZE` and `LOG_ROTATE_MAX_FILES` as needed
- The logs directory should have appropriate permissions for the application user

## Troubleshooting

### Common Issues

- **Application doesn't start**: Check the logs for errors
- **WebSocket connection fails**: Ensure your proxy is configured to support WebSockets
- **Rate limiting issues**: Adjust the rate limit settings in the .env file

Consult the logs in the configured LOG_DIR for detailed error information.
