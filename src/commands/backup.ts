import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { BackupOptions } from '../types';
import { ConfigManager } from '../modules/config';
import { MySQLManager } from '../modules/mysql';
import { S3Manager } from '../modules/s3';
import { progressTracker } from '../modules/progress';

export async function backupCommand(options: BackupOptions): Promise<void> {
  try {
    // Load configuration - backup command needs both database and S3 credentials
    const configManager = ConfigManager.getInstance();
    const config = configManager.loadConfig(options.configFile, { requireDatabase: true, requireS3: true });

    if (options.verbose) {
      console.log(chalk.blue('ℹ Configuration loaded successfully'));
      console.log(chalk.gray(`Database: ${config.database.host}:${config.database.port}`));
      console.log(chalk.gray(`S3 Bucket: ${config.s3.bucket}`));
      if (config.s3.endpointUrl) {
        console.log(chalk.gray(`S3 Endpoint: ${config.s3.endpointUrl}`));
      }
    }

    // Initialize managers
    const mysqlManager = new MySQLManager(config.database);
    const s3Manager = new S3Manager(config.s3);

    // Test database connection
    console.log(chalk.blue('ℹ Testing database connection...'));
    await mysqlManager.testConnection();
    console.log(chalk.green('✓ Database connection successful'));

    // Generate backup file paths
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const s3Key = config.s3.key 
      ? `${config.s3.key}-${timestamp}.sql.gz`
      : configManager.generateS3Key(config.database.database);

    const tempDir = os.tmpdir();
    const tempBackupPath = path.join(tempDir, `backup-${Date.now()}.sql.gz`);

    try {
      // Create backup
      console.log(chalk.blue('ℹ Creating database backup...'));
      const backupProgress = progressTracker.createProgressBar('Creating backup');

      await mysqlManager.createBackup(tempBackupPath, backupProgress);
      progressTracker.stop();
      console.log(chalk.green('✓ Database backup created'));

      // Get backup file size
      const stats = fs.statSync(tempBackupPath);
      const fileSize = s3Manager.formatFileSize(stats.size);

      if (options.verbose) {
        console.log(chalk.gray(`Backup size: ${fileSize}`));
        console.log(chalk.gray(`Uploading to: s3://${config.s3.bucket}/${s3Key}`));
      }

      // Upload to S3
      console.log(chalk.blue('ℹ Uploading backup to S3...'));
      const uploadProgress = progressTracker.createProgressBar('Uploading');

      await s3Manager.uploadFile(tempBackupPath, s3Key, uploadProgress);
      progressTracker.stop();
      console.log(chalk.green('✓ Backup uploaded to S3'));

      // Success message
      console.log('');
      console.log(chalk.green.bold('🎉 Backup completed successfully!'));
      console.log('');
      console.log(`${chalk.cyan('Backup details:')}`);
      console.log(`  Database: ${config.database.database || 'all databases'}`);
      console.log(`  Size: ${fileSize}`);
      console.log(`  Location: s3://${config.s3.bucket}/${s3Key}`);
      console.log(`  Created: ${new Date().toLocaleString()}`);

    } finally {
      // Clean up temporary file
      if (fs.existsSync(tempBackupPath)) {
        fs.unlinkSync(tempBackupPath);
        if (options.verbose) {
          console.log(chalk.gray('Temporary backup file cleaned up'));
        }
      }
    }

  } catch (error: unknown) {
    progressTracker.stop();
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(chalk.red('✗ Backup failed:'), errorMessage);

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }

    process.exit(1);
  }
}
