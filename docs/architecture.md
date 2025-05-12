# Startup Manager Architecture Document

## Overview

The Startup Manager is a web application for managing and monitoring programs that need to be started, stopped, and monitored. It provides a user interface for managing programs and a terminal interface for interacting with them.

## Tech Stack

- **Frontend**: Next.js with React 19
- **Backend**: Node.js with Express (for middleware) and Socket.IO
- **UI**: Custom CSS with dark/light theme support via ThemeContext
- **Terminal**: xterm.js for interactive terminal sessions
- **Websockets**: Socket.IO for real-time communication

## Core Components

### Server Layer

- **server.ts**: Entry point and HTTP server with Express middleware
  - Implements Helmet for security headers
  - Provides rate limiting protection
  - Manages request logging with enhanced IP tracking

### Communication Layer

- **WebSocketServer**: Manages real-time communication with clients
- **TerminalServer**: Provides terminal functionality via WebSockets

### Domain Layer

- **ProgramManager**: Manages programs and their configurations
- **Program**: Represents a program that can be started/stopped

### Infrastructure

- **config.ts**: Centralized configuration system with environment variable support
- **logger.ts**: Structured logging system with IP address tracking and sensitive data filtering

## Security Features

- **Helmet**: Implements security headers to prevent common web vulnerabilities
- **Rate Limiting**: Protects against brute force attacks
- **IP Logging**: Tracks client IP addresses for security monitoring
- **Sensitive Data Filtering**: Prevents sensitive information from being logged
- **CORS Protection**: Restricts access to allowed origins

## Data Flow

1. User makes a request to the server
2. Server applies security middleware (Helmet, rate limiting)
3. Request is processed by Next.js or WebSocket server
4. Actions are dispatched to the ProgramManager or TerminalServer
5. Results are sent back to the client via HTTP or WebSockets

## Deployment Considerations

- Requires Node.js >= 18.x
- Uses environment variables for configuration
- Supports both development and production modes
- Can be containerized for easier deployment

## Theme System

Implements a dark/light theme system using:
- `ThemeContext` provider for state management
- `ThemeToggle` component for user interaction
- CSS variables for adaptive styling
- LocalStorage for user preference persistence
- Dark mode is set as the default theme
