import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import * as inquirer from 'inquirer';
import { RestoreOptions } from '../types';
import { ConfigManager } from '../modules/config';
import { MySQLManager } from '../modules/mysql';
import { S3Manager } from '../modules/s3';
import { progressTracker } from '../modules/progress';

export async function restoreCommand(options: RestoreOptions): Promise<void> {
  try {
    // Load configuration
    const configManager = ConfigManager.getInstance();
    const config = configManager.loadConfig(options.configFile);

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

    let selectedBackupKey: string;
    let targetDatabase: string;

    if (options.interactive !== false) {
      // Interactive mode
      console.log(chalk.blue('ℹ Fetching available backups...'));
      const backups = await s3Manager.listBackups();

      if (backups.length === 0) {
        console.error(chalk.red('✗ No backups found in the S3 bucket'));
        process.exit(1);
      }

      // Select backup
      const backupChoices = backups.map((backup) => ({
        name: `${backup.displayName} (${s3Manager.formatFileSize(backup.size)})`,
        value: backup.key,
        short: backup.displayName
      }));

      const backupAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'backup',
          message: 'Select a backup to restore:',
          choices: backupChoices,
          pageSize: 10
        }
      ]);

      selectedBackupKey = backupAnswer.backup;

      // Get available databases
      console.log(chalk.blue('ℹ Fetching available databases...'));
      const databases = await mysqlManager.listDatabases();

      const databaseChoices = databases.map(db => ({ name: db, value: db }));
      databaseChoices.push({ name: '[ Enter a different database name ]', value: 'custom' });

      const databaseAnswer = await inquirer.prompt([
        {
          type: 'list',
          name: 'database',
          message: 'Select target database:',
          choices: databaseChoices,
          pageSize: 10
        }
      ]);

      if (databaseAnswer.database === 'custom') {
        const customDbAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'database',
            message: 'Enter database name:',
            validate: (input) => input.trim().length > 0 || 'Database name cannot be empty'
          }
        ]);
        targetDatabase = customDbAnswer.database.trim();
      } else {
        targetDatabase = databaseAnswer.database;
      }

      // Confirmation
      const selectedBackup = backups.find(b => b.key === selectedBackupKey);
      console.log('');
      console.log(chalk.yellow.bold('⚠ WARNING: This will overwrite data in the target database!'));
      console.log('');
      console.log(`${chalk.cyan('Restore details:')}`);
      console.log(`  Backup: ${selectedBackup?.displayName}`);
      console.log(`  Size: ${s3Manager.formatFileSize(selectedBackup?.size || 0)}`);
      console.log(`  Target database: ${targetDatabase}`);
      console.log(`  MySQL server: ${config.database.host}:${config.database.port}`);
      console.log('');

      if (!options.force) {
        const confirmAnswer = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message: 'Are you sure you want to proceed?',
            default: false
          }
        ]);

        if (!confirmAnswer.proceed) {
          console.log(chalk.yellow('Restoration cancelled.'));
          return;
        }
      }

    } else {
      // Non-interactive mode
      if (!options.backup) {
        console.error(chalk.red('✗ Backup key is required in non-interactive mode'));
        process.exit(1);
      }

      if (!options.database) {
        console.error(chalk.red('✗ Target database is required in non-interactive mode'));
        process.exit(1);
      }

      selectedBackupKey = options.backup;
      targetDatabase = options.database;

      // Verify backup exists
      const backupExists = await s3Manager.backupExists(selectedBackupKey);
      if (!backupExists) {
        console.error(chalk.red(`✗ Backup not found: ${selectedBackupKey}`));
        process.exit(1);
      }

      // Show warning in non-interactive mode
      if (!options.force) {
        console.log(chalk.yellow.bold('⚠ WARNING: This will overwrite data in the target database!'));
        console.log(chalk.yellow('Use --force flag to skip this confirmation in non-interactive mode.'));
        process.exit(1);
      }
    }

    // Check if target database exists
    const dbExists = await mysqlManager.databaseExists(targetDatabase);
    if (!dbExists && options.verbose) {
      console.log(chalk.yellow(`⚠ Target database '${targetDatabase}' does not exist. It will be created during restore.`));
    }

    const tempDir = os.tmpdir();
    const tempBackupPath = path.join(tempDir, `restore-${Date.now()}.sql.gz`);

    try {
      // Try streaming restore first (unless explicitly disabled)
      if (options.streaming !== false) {
        try {
          console.log(chalk.blue('ℹ Starting streaming restore from S3...'));
          const restoreProgress = progressTracker.createProgressBar('Streaming restore');

          // Get download stream from S3
          const { stream, totalSize } = await s3Manager.downloadStream(selectedBackupKey, restoreProgress);
          
          // Stream directly to MySQL
          await mysqlManager.restoreBackupFromStream(stream, totalSize, targetDatabase, restoreProgress);
          progressTracker.stop();
          console.log(chalk.green('✓ Streaming restore completed'));

          // Success message
          console.log('');
          console.log(chalk.green.bold('🎉 Restore completed successfully!'));
          console.log('');
          console.log(`${chalk.cyan('Restore details:')}`);
          console.log(`  Backup: ${selectedBackupKey}`);
          console.log(`  Target database: ${targetDatabase}`);
          console.log(`  MySQL server: ${config.database.host}:${config.database.port}`);
          console.log(`  Method: Streaming (no temporary file)`);
          console.log(`  Completed: ${new Date().toLocaleString()}`);
          return;

        } catch (streamError) {
          progressTracker.stop();
          if (options.verbose) {
            console.log(chalk.yellow(`⚠ Streaming restore failed: ${streamError}`));
            console.log(chalk.yellow('ℹ Falling back to file-based restore...'));
          } else {
            console.log(chalk.yellow('ℹ Falling back to file-based restore...'));
          }
        }
      }

      // Fallback to file-based restore (original implementation)
      console.log(chalk.blue('ℹ Downloading backup from S3...'));
      const downloadProgress = progressTracker.createProgressBar('Downloading');

      await s3Manager.downloadFile(selectedBackupKey, tempBackupPath, downloadProgress);
      progressTracker.stop();
      console.log(chalk.green('✓ Backup downloaded'));

      // Restore backup
      console.log(chalk.blue('ℹ Restoring backup to database...'));
      const restoreProgress = progressTracker.createProgressBar('Restoring');

      await mysqlManager.restoreBackup(tempBackupPath, targetDatabase, restoreProgress);
      progressTracker.stop();
      console.log(chalk.green('✓ Backup restored to database'));

      // Success message
      console.log('');
      console.log(chalk.green.bold('🎉 Restore completed successfully!'));
      console.log('');
      console.log(`${chalk.cyan('Restore details:')}`);
      console.log(`  Backup: ${selectedBackupKey}`);
      console.log(`  Target database: ${targetDatabase}`);
      console.log(`  MySQL server: ${config.database.host}:${config.database.port}`);
      console.log(`  Method: File-based restore`);
      console.log(`  Completed: ${new Date().toLocaleString()}`);

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
    console.error(chalk.red('✗ Restore failed:'), errorMessage);

    if (options.verbose && error instanceof Error && error.stack) {
      console.error(chalk.gray(error.stack));
    }

    process.exit(1);
  }
}
