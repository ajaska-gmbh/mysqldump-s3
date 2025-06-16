import { spawn } from 'child_process';
import { createConnection } from 'mysql2/promise';
import * as zlib from 'zlib';
import * as fs from 'fs';
import { DatabaseConfig, ProgressCallback } from '../types';

export class MySQLManager {
  constructor(private config: DatabaseConfig) {}

  public async testConnection(): Promise<void> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database
    });

    await connection.ping();
    await connection.end();
  }

  public async listDatabases(): Promise<string[]> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password
    });

    try {
      const [rows] = await connection.execute('SHOW DATABASES');
      const databases = (rows as { Database: string }[])
        .map((row) => row.Database)
        .filter(db => !['information_schema', 'performance_schema', 'mysql', 'sys'].includes(db));

      return databases;
    } finally {
      await connection.end();
    }
  }

  public async createBackup(outputPath: string, progressCallback?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        '--compress',
        '--verbose',
        '--lock-tables=false'
      ];

      if (this.config.database) {
        args.push(this.config.database);
      } else {
        args.push('--all-databases');
      }

      const mysqldump = spawn('mysqldump', args);
      const gzip = zlib.createGzip();
      const output = fs.createWriteStream(outputPath);

      let totalBytes = 0;
      let error = '';

      // Track progress if callback provided
      if (progressCallback) {
        gzip.on('data', (chunk) => {
          totalBytes += chunk.length;
          progressCallback({ loaded: totalBytes });
        });
      }

      // Handle mysqldump errors
      mysqldump.stderr.on('data', (data) => {
        error += data.toString();
      });

      mysqldump.on('error', (err) => {
        reject(new Error(`Failed to start mysqldump: ${err.message}`));
      });

      mysqldump.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`mysqldump exited with code ${code}: ${error}`));
        }
      });

      // Handle gzip errors
      gzip.on('error', (err) => {
        reject(new Error(`Compression failed: ${err.message}`));
      });

      // Handle output file errors
      output.on('error', (err) => {
        reject(new Error(`Failed to write backup file: ${err.message}`));
      });

      output.on('finish', () => {
        if (progressCallback) {
          progressCallback({ loaded: totalBytes, percentage: 100 });
        }
        resolve();
      });

      // Pipe data through compression to output file
      mysqldump.stdout.pipe(gzip).pipe(output);
    });
  }

  public async restoreBackup(backupPath: string, targetDatabase: string, progressCallback?: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(backupPath)) {
        reject(new Error(`Backup file not found: ${backupPath}`));
        return;
      }

      const stats = fs.statSync(backupPath);
      const totalSize = stats.size;
      let processedBytes = 0;

      const gunzip = zlib.createGunzip();
      // Use optimized MySQL parameters for faster import
      const mysql = spawn('mysql', [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        // Performance optimization flags
        '--max_allowed_packet=1G',
        '--net_buffer_length=1000000',
        // Continue even if errors occur
        '--force',
        // Set session variables to optimize import performance
        // Use session variables where possible to avoid requiring SUPER privileges
        '--init-command=SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0; SET SESSION autocommit=0; SET SESSION sql_log_bin=0;',
        targetDatabase
      ]);

      const input = fs.createReadStream(backupPath);
      let error = '';
      let isResolved = false;

      const handleError = (err: Error, source: string) => {
        if (!isResolved) {
          isResolved = true;
          reject(new Error(`${source}: ${err.message}`));
        }
      };

      const handleSuccess = async () => {
        if (!isResolved) {
          isResolved = true;

          // Reset MySQL settings to safe values after import
          try {
            const connection = await createConnection({
              host: this.config.host,
              port: this.config.port,
              user: this.config.user,
              password: this.config.password
            });

            // Reset session variables to their default values
            await connection.execute('SET SESSION foreign_key_checks=1');
            await connection.execute('SET SESSION unique_checks=1');
            await connection.execute('SET SESSION autocommit=1');
            await connection.execute('SET SESSION sql_log_bin=1');

            // Commit any pending transactions in the target database
            await connection.execute(`USE ${targetDatabase}`);
            await connection.execute('COMMIT');

            await connection.end();
          } catch (err) {
            console.warn(`Warning: Failed to reset MySQL settings: ${err instanceof Error ? err.message : String(err)}`);
            // Continue with resolution even if reset fails
          }

          if (progressCallback) {
            progressCallback({ loaded: totalSize, total: totalSize, percentage: 100 });
          }
          resolve();
        }
      };

      // Track progress if callback provided
      if (progressCallback) {
        // Track progress on the decompressed data for more accurate feedback
        let decompressedBytes = 0;

        // Initialize with a rough estimate that decompressed size is ~5x compressed size
        // This will be adjusted as we process the actual data
        let estimatedTotalDecompressed = totalSize * 5;

        gunzip.on('data', (chunk) => {
          decompressedBytes += chunk.length;

          // Dynamically adjust the total estimate based on compression ratio observed so far
          if (processedBytes > 0) {
            const currentRatio = decompressedBytes / processedBytes;
            estimatedTotalDecompressed = totalSize * currentRatio;
          }

          const percentage = Math.min(99, (decompressedBytes / estimatedTotalDecompressed) * 100);
          progressCallback({ 
            loaded: decompressedBytes, 
            total: estimatedTotalDecompressed, 
            percentage 
          });
        });

        // Also track compressed data progress for reference
        input.on('data', (chunk) => {
          processedBytes += chunk.length;
        });
      }

      // Handle mysql process errors
      mysql.stderr.on('data', (data) => {
        error += data.toString();
      });

      mysql.on('error', (err) => {
        handleError(err, 'Failed to start mysql');
      });

      mysql.on('close', (code) => {
        if (code !== 0) {
          handleError(new Error(`mysql exited with code ${code}: ${error}`), 'MySQL process failed');
        } else {
          // Ensure all streams are properly closed before resolving
          input.destroy();
          gunzip.destroy();

          // Small delay to ensure all resources are properly released
          setTimeout(() => {
            handleSuccess();
          }, 100);
        }
      });

      // Handle mysql stdin pipe errors (EPIPE protection)
      mysql.stdin.on('error', (err: Error & { code?: string }) => {
        // EPIPE error typically means the mysql process has closed
        // Check if it's an expected closure or an error
        if (err.code === 'EPIPE') {
          // Don't immediately reject, wait for mysql process to close
          // The mysql 'close' event will handle the final resolution
          return;
        }
        handleError(err, 'MySQL stdin pipe error');
      });

      // Handle gunzip errors
      gunzip.on('error', (err) => {
        handleError(err, 'Decompression failed');
      });

      // Handle input file errors
      input.on('error', (err) => {
        handleError(err, 'Failed to read backup file');
      });

      // Handle pipe errors in the stream pipeline
      const pipeline = input.pipe(gunzip);

      pipeline.on('error', (err) => {
        handleError(err, 'Pipeline error');
      });

      // Set up the final pipe to mysql with error handling
      pipeline.pipe(mysql.stdin, { end: true });

      // Handle backpressure by pausing/resuming the input stream
      mysql.stdin.on('drain', () => {
        input.resume();
      });

      if (mysql.stdin.writableHighWaterMark && mysql.stdin.writableLength > mysql.stdin.writableHighWaterMark) {
        input.pause();
      }
    });
  }

  public async databaseExists(databaseName: string): Promise<boolean> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password
    });

    try {
      const [rows] = await connection.execute(
        'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [databaseName]
      );
      return (rows as unknown[]).length > 0;
    } finally {
      await connection.end();
    }
  }
}
