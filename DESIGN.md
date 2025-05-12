# Startup Manager - Design Document

## 1. Introduction

The Startup Manager is a web-based application designed to manage, monitor, and control multiple running programs or services. It provides a convenient way to start, stop, and monitor the status of various applications through a modern web interface. The application also includes a terminal interface for direct interaction with running programs.

### 1.1 Purpose

The primary goal of the Startup Manager is to simplify the management of multiple services and applications running on a server, providing:

- A centralized dashboard for monitoring program status
- Easy start/stop/restart controls for each program
- Terminal access to running programs
- Automated startup of configured services
- Logging and status tracking

### 1.2 Target Audience

This application is intended for:
- System administrators
- DevOps professionals
- Software developers
- Anyone who needs to manage multiple programs running on a server

## 2. Architecture Overview

The Startup Manager is built using a modern client-server architecture:

### 2.1 Client-Side (Frontend)

- **Framework**: Next.js with React
- **UI Components**: Custom components with modern styling
- **State Management**: React Context API
- **Theming**: Supports both light and dark mode via ThemeContext
- **WebSocket**: Real-time communication with the server

### 2.2 Server-Side (Backend)

- **Runtime**: Node.js
- **Framework**: Custom HTTP server with Socket.IO for WebSockets
- **Terminal**: Node-PTY for terminal emulation
- **Process Management**: Custom Program Manager for process control

### 2.3 Communication

- **WebSockets**: Socket.IO for real-time bidirectional communication
- **RPC Pattern**: JSON-RPC style request/response pattern for client-server communication
- **Terminal Data**: Streaming terminal I/O via WebSockets

## 2.4 Security Model

- **Authentication**: All WebSocket and terminal connections require authentication using credentials from environment variables.
- **Rate Limiting**: Rate limiting is enforced for authentication attempts to prevent brute force attacks.
- **Logging & IP Tracking**: All HTTP and WebSocket actions are logged with request IDs and IP addresses. Debug logs are gated to non-production environments. No sensitive data is logged. Privacy implications of IP logging are reviewed.
- **Input Validation**: All user input (e.g., PIDs, commands) is validated and sanitized.
- **CORS**: CORS is enabled and restricted to allowed origins in production.
- **Stack Trace Hiding**: Internal errors and stack traces are never exposed to users in production.

## 3. Component Design

### 3.1 Program Manager (`ProgramManager`)

Responsible for:
- Storing program configurations
- Starting, stopping, and monitoring programs
- Providing status updates via callbacks
- Persisting program configs to disk

### 3.2 WebSocket Server (`WebSocketServer`)

Responsible for:
- Authenticating clients
- Handling RPC requests from clients
- Broadcasting program status changes
- Rate limiting and security enforcement

### 3.3 Terminal Server (`TerminalServer`)

Responsible for:
- Creating and managing terminal sessions
- Connecting terminals to programs
- Streaming terminal I/O to clients
- Security validation for terminal commands

### 3.4 UI Components

- **App**: Main application container
- **ProgramList**: Displays all configured programs
- **ProgramForm**: Form for adding/editing programs
- **Terminal**: Interactive terminal interface
- **TabsContainer**: Provides tabbed interface for multiple terminals
- **ThemeToggle**: Allows switching between light and dark mode

## 4. Data Flow

### 4.1 Program Management Flow

1. Client submits program configuration via WebSocket RPC
2. Server validates and stores the configuration
3. Server starts the program (if auto-start is enabled)
4. Server monitors program status
5. Status changes are broadcast to all connected clients

### 4.2 Terminal Flow

1. Client requests a terminal session
2. Server creates a PTY process
3. Client connects to the terminal via WebSocket
4. Terminal I/O is streamed bidirectionally
5. Client can send commands and receive output

## 5. Security Considerations

### 5.1 Authentication

- Basic username/password authentication for WebSocket connections
- Credentials configurable via environment variables
- Rate limiting to prevent brute force attacks

### 5.2 Command Validation

- Terminal commands are validated to prevent dangerous operations
- Blacklist of dangerous commands (e.g., `rm -rf /`)
- Input validation for all API endpoints

### 5.3 Logging

- Comprehensive logging with different levels
- IP address logging for all connections
- Sensitive command detection and logging
- Configurable log destination (console/file)

### 5.4 CORS Protection

- Configurable allowed origins for production environments
- Protection against unauthorized cross-origin requests

## 6. Configuration

The application is highly configurable through environment variables:

- Server settings (port, host)
- Security settings (admin credentials, allowed origins)
- Logging settings (level, file output)
- Program settings (config path, limits)

A `.env.example` file is provided as a template.

## 7. Deployment Considerations

### 7.1 Prerequisites

- Node.js v14+ with npm
- Linux-based OS (for full terminal support)
- Sufficient permissions to start/stop programs

### 7.2 Installation

1. Clone the repository
2. Install dependencies with `npm install`
3. Copy `.env.example` to `.env` and configure
4. Build the application with `npm run build`
5. Start the server with `npm start`

### 7.3 Production Hardening

For production deployment:
- Set strong admin credentials
## 7. Deployment Best Practices

- Set all secrets and credentials via environment variables
- Enable HTTPS via reverse proxy
- Configure allowed origins for CORS
- Use a non-root user to run the application
- Set appropriate permissions for config files
- Configure log rotation for log files

## 8. Future Enhancements

Potential improvements for future releases:

- Two-factor authentication
- Role-based access control
- Resource usage monitoring
- Scheduled tasks/cron integration
- External API integrations
- Improved log analysis
- Clustering support for high availability

## 9. Conclusion

The Startup Manager provides a robust, secure, and user-friendly interface for managing multiple programs on a server. Its architecture prioritizes security, real-time updates, and ease of use, making it suitable for various deployment scenarios from development environments to production servers.
