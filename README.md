# Startup Manager

A Next.js application for managing and monitoring programs running on your server with screen session integration.

## Features

- Web-based management of services and programs
- Run programs in named screen sessions
- Monitor program status in real-time
- Start, stop, and terminate programs
- Connect to program terminals through the web interface
- WebSocket-based RPC API for real-time communications
- Authentication system to secure access

## Requirements

- Node.js 18+ and npm
- Linux system with screen installed
- Modern web browser

## Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd startup-manager
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the project root with the following variables:

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=yourSecurePassword
CONFIG_PATH=/path/to/config/directory/programs.json
PORT=3000
```

## Running the Application

### Development Mode

To run the application in development mode with hot-reloading:

```bash
npm run dev:server
```

### Production Mode

Build the application for production:

```bash
npm run build
npm run build:server
```

Start the production server:

```bash
npm run start:prod
```

## Usage

1. Open your browser and navigate to `http://localhost:3000` (or the configured port)
2. Login with the credentials set in the `.env` file
3. Use the UI to manage your programs:
   - Add new programs with a name, command, and screen name
   - Start/stop existing programs
   - Monitor program status in real-time
   - Connect to terminal sessions for running programs

## API

The application provides a WebSocket-based RPC API with the following methods:

- `listPrograms`: Get a list of all configured programs
- `addProgram`: Add a new program
- `editProgram`: Update an existing program
- `deleteProgram`: Delete a program
- `startProgram`: Start a program in its screen session
- `stopProgram`: Send SIGINT to a running program
- `terminateProgram`: Kill a running program
- `getProgramStatus`: Get the current status of a program
- `startScreen`: Start a new screen session for a program
- `sendCommandToScreen`: Send a command to a screen session

## License

MIT
