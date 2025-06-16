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

  /**
   * Restores a MySQL backup from a gzipped SQL file with optimized performance.
   * 
   * Performance optimizations:
   * 1. Uses a temporary my.cnf file with optimized client settings
   * 2. Increases max_allowed_packet and net_buffer_length for faster data transfer
   * 3. Disables foreign key checks, unique checks, and autocommit during import
   * 4. Disables binary logging during import
   * 5. Re-enables all checks and commits changes after import completes
   * 
   * These optimizations can significantly reduce restoration time for large dumps.
   * A 400MB dump that previously took 2 hours may now complete in minutes.
   */
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

      // Create a temporary my.cnf file with optimized settings
      const tempMyCnfPath = `/tmp/mysql_restore_${Date.now()}.cnf`;
      const myCnfContent = `
[client]
host=${this.config.host}
port=${this.config.port}
user=${this.config.user}
password=${this.config.password}

[mysql]
max_allowed_packet=1G
net_buffer_length=1000000
default-character-set=utf8
`;

      try {
        fs.writeFileSync(tempMyCnfPath, myCnfContent, { mode: 0o600 }); // Secure permissions
      } catch (err) {
        reject(new Error(`Failed to create temporary MySQL config: ${err}`));
        return;
      }

      // Add performance optimization flags to MySQL client
      const mysql = spawn('mysql', [
        `--defaults-file=${tempMyCnfPath}`,
        '--max-allowed-packet=1G',        // Increase max packet size
        '--net-buffer-length=1000000',    // Increase network buffer
        '--default-character-set=utf8',   // Ensure consistent character set
        '--init-command=SET SESSION FOREIGN_KEY_CHECKS=0; SET SESSION UNIQUE_CHECKS=0; SET SESSION AUTOCOMMIT=0;',
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

      const handleSuccess = () => {
        if (!isResolved) {
          isResolved = true;
          if (progressCallback) {
            progressCallback({ loaded: totalSize, total: totalSize, percentage: 100 });
          }
          resolve();
        }
      };

      // Track progress if callback provided
      if (progressCallback) {
        input.on('data', (chunk) => {
          processedBytes += chunk.length;
          const percentage = (processedBytes / totalSize) * 100;
          progressCallback({ 
            loaded: processedBytes, 
            total: totalSize, 
            percentage 
          });
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
        // Clean up the temporary my.cnf file
        if (fs.existsSync(tempMyCnfPath)) {
          try {
            fs.unlinkSync(tempMyCnfPath);
          } catch (err) {
            console.error(`Warning: Failed to delete temporary MySQL config file: ${err}`);
          }
        }

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

      // Disable constraints and checks before import to improve performance
      mysql.stdin.write('SET FOREIGN_KEY_CHECKS=0;\n');
      mysql.stdin.write('SET UNIQUE_CHECKS=0;\n');
      mysql.stdin.write('SET AUTOCOMMIT=0;\n');
      mysql.stdin.write('SET SQL_LOG_BIN=0;\n');

      // Set up the final pipe to mysql with error handling
      pipeline.pipe(mysql.stdin, { end: false });  // Changed to end: false to allow writing after pipe ends

      // Handle pipeline end to re-enable constraints and commit
      pipeline.on('end', () => {
        // Re-enable constraints and checks after import
        mysql.stdin.write('SET FOREIGN_KEY_CHECKS=1;\n');
        mysql.stdin.write('SET UNIQUE_CHECKS=1;\n');
        mysql.stdin.write('SET AUTOCOMMIT=1;\n');
        mysql.stdin.write('SET SQL_LOG_BIN=1;\n');
        mysql.stdin.write('COMMIT;\n');
        mysql.stdin.end();  // Now end the stream
      });

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
