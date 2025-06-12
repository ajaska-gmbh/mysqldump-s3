import chalk from 'chalk';
import { ListOptions } from '../types';
import { ConfigManager } from '../modules/config';
import { S3Manager } from '../modules/s3';

export async function listCommand(options: ListOptions): Promise<void> {
  try {
    // Load configuration
    const configManager = ConfigManager.getInstance();
    const config = configManager.loadConfig(options.configFile);

    if (options.verbose) {
      console.log(chalk.blue('ℹ Configuration loaded successfully'));
      console.log(chalk.gray(`S3 Bucket: ${config.s3.bucket}`));
      if (config.s3.endpointUrl) {
        console.log(chalk.gray(`S3 Endpoint: ${config.s3.endpointUrl}`));
      }
    }

    // Initialize S3 manager
    const s3Manager = new S3Manager(config.s3);

    // List backups
    console.log(chalk.blue('ℹ Fetching list of available backups...'));
    const backups = await s3Manager.listBackups();

    if (backups.length === 0) {
      console.log(chalk.yellow('⚠ No backups found in the S3 bucket'));
      return;
    }

    console.log(chalk.green(`✓ Found ${backups.length} backup${backups.length === 1 ? '' : 's'}`));
    console.log('');

    if (options.format === 'json') {
      // JSON output
      const jsonOutput = backups.map(backup => ({
        key: backup.key,
        displayName: backup.displayName,
        lastModified: backup.lastModified.toISOString(),
        size: backup.size,
        sizeFormatted: s3Manager.formatFileSize(backup.size)
      }));

      console.log(JSON.stringify(jsonOutput, null, 2));
    } else {
      // Table output (default)
      console.log(chalk.cyan.bold('Available Backups:'));
      console.log('');

      // Calculate column widths
      const maxNameWidth = Math.max(
        ...backups.map(b => b.displayName.length),
        'Name'.length
      );
      const maxSizeWidth = Math.max(
        ...backups.map(b => s3Manager.formatFileSize(b.size).length),
        'Size'.length
      );

      // Header
      const nameHeader = 'Name'.padEnd(maxNameWidth);
      const sizeHeader = 'Size'.padEnd(maxSizeWidth);
      const dateHeader = 'Last Modified';

      console.log(chalk.bold(`${nameHeader} | ${sizeHeader} | ${dateHeader}`));
      console.log('-'.repeat(nameHeader.length + sizeHeader.length + dateHeader.length + 6));

      // Backup rows
      backups.forEach((backup, index) => {
        const nameCell = backup.displayName.padEnd(maxNameWidth);
        const sizeCell = s3Manager.formatFileSize(backup.size).padEnd(maxSizeWidth);
        const dateCell = backup.lastModified.toLocaleString();

        const rowColor = index % 2 === 0 ? chalk.white : chalk.gray;
        console.log(rowColor(`${nameCell} | ${sizeCell} | ${dateCell}`));
      });

      console.log('');
      console.log(chalk.gray(`Total: ${backups.length} backup${backups.length === 1 ? '' : 's'}`));

      if (options.verbose) {
        const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);
        console.log(chalk.gray(`Total size: ${s3Manager.formatFileSize(totalSize)}`));
      }
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red('✗ Failed to list backups:'), errorMessage);

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }

    process.exit(1);
  }
}
