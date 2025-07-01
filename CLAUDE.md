# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript CLI tool for MySQL database backup and restore operations with S3 integration. It's a complete rewrite of the original Docker-based solution, now providing a modern Node.js CLI with enhanced features.

## Commands

### Development Commands
- `npm run dev` - Run the CLI in development mode using ts-node
- `npm run build` - Compile TypeScript to JavaScript (output to /dist)
- `npm test` - Run all Jest tests
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Generate test coverage report (HTML in /coverage)
- `npm run lint` - Run ESLint on TypeScript files
- `npm run lint:fix` - Auto-fix linting issues
- `npm run clean` - Remove build artifacts and coverage reports

### CLI Usage
After building or in dev mode:
- `mysqldump-s3 backup` - Run backup operation
- `mysqldump-s3 list` - List available backups
- `mysqldump-s3 restore` - Restore from backup
- `mysqldump-s3 --help` - Show help for any command

### Testing Individual Files
- `npm test -- src/__tests__/backup.test.ts` - Run specific test file
- `npm test -- --testNamePattern="should handle"` - Run tests matching pattern

## Architecture

### Modular Design
The codebase follows a clear separation of concerns:

1. **Command Layer** (`/src/commands/`)
   - Each command (backup, list, restore) is a separate module
   - Commands handle orchestration and user interaction
   - Uses progress callbacks for real-time feedback

2. **Module Layer** (`/src/modules/`)
   - `ConfigManager` - Singleton for configuration management, merges env vars, CLI args, and config files
   - `MysqlManager` - Handles MySQL connections and operations using mysql2 library
   - `S3Manager` - Manages S3 operations with streaming support for large files
   - `ProgressTracker` - Creates and manages progress bars using cli-progress

3. **Configuration Hierarchy**
   Priority order (highest to lowest):
   - CLI arguments
   - Environment variables
   - Config file (JSON or YAML)
   - Default values

### Key Patterns

1. **Stream Processing**: All backup/restore operations use Node.js streams for memory efficiency with large databases

2. **Error Handling**: Consistent try-catch-finally blocks with proper cleanup of resources (MySQL connections, S3 streams)

3. **Progress Tracking**: Real-time progress bars for all long-running operations using callback patterns

4. **Interactive Mode**: Restore command supports interactive prompts using inquirer.js when backup name not specified

5. **Async/Await**: All asynchronous operations use modern async/await syntax instead of callbacks

### Docker Integration
- The project can run as a Docker container with MySQL client pre-installed
- `entrypoint.sh` supports both new CLI mode and legacy bash mode for backward compatibility
- Kubernetes deployment available in `/kube/job.yaml`

## Important Implementation Details

- MySQL dumps use `mysqldump` binary for backups and `mysql` binary for restores
- S3 operations support both AWS S3 and S3-compatible endpoints (like MinIO)
- Configuration validation happens early with descriptive error messages
- All commands support both programmatic and CLI usage
- Progress tracking is optional and can be disabled
- Backup filenames include timestamp: `${prefix}_${date}_${time}.sql.gz`