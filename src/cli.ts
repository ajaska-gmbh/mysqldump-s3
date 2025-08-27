#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { backupCommand } from './commands/backup';
import { listCommand } from './commands/list';
import { restoreCommand } from './commands/restore';

const program = new Command();

program
  .name('mysqldump-s3')
  .description('Node.js CLI tool to dump MySQL databases and upload to Amazon S3, with backup listing and restore functionality')
  .version('1.0.0');

// Backup command
program
  .command('backup')
  .description('Create a database backup and upload to S3')
  .option('-c, --config <file>', 'Configuration file path (JSON or YAML)')
  .option('-s, --schemas <schemas>', 'Comma-separated list of schemas to backup')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    await backupCommand(options);
  });

// List command
program
  .command('list')
  .description('List available backups in S3')
  .option('-c, --config <file>', 'Configuration file path (JSON or YAML)')
  .option('-f, --format <format>', 'Output format (table|json)', 'table')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    if (options.format && !['table', 'json'].includes(options.format)) {
      console.error(chalk.red('✗ Invalid format. Use "table" or "json"'));
      process.exit(1);
    }
    await listCommand(options);
  });

// Restore command
program
  .command('restore')
  .description('Restore a backup from S3 to MySQL database')
  .option('-c, --config <file>', 'Configuration file path (JSON or YAML)')
  .option('-b, --backup <key>', 'S3 backup key to restore (required for non-interactive mode)')
  .option('-d, --database <name>', 'Target database name (required for non-interactive mode)')
  .option('--non-interactive', 'Run in non-interactive mode')
  .option('--force', 'Skip confirmation prompts')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    await restoreCommand({
      ...options,
      interactive: !options.nonInteractive
    });
  });

// Global error handler
process.on('uncaughtException', (error) => {
  console.error(chalk.red('✗ Uncaught exception:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('✗ Unhandled rejection at:'), promise, 'reason:', reason);
  process.exit(1);
});

// Parse command line arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
