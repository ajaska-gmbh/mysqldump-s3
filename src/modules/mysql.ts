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
      const mysql = spawn('mysql', [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
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

  public async restoreBackupFromStream(
    inputStream: NodeJS.ReadableStream,
    totalSize: number,
    targetDatabase: string,
    progressCallback?: ProgressCallback
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let processedBytes = 0;
      let isResolved = false;

      const gunzip = zlib.createGunzip();
      const mysql = spawn('mysql', [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        targetDatabase
      ]);

      let error = '';

      const handleError = (err: Error, source: string) => {
        if (!isResolved) {
          isResolved = true;
          // Clean up streams
          const stream = inputStream as any;
          if (stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
          gunzip.destroy();
          if (!mysql.killed) {
            mysql.kill('SIGTERM');
          }
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
      if (progressCallback && totalSize > 0) {
        inputStream.on('data', (chunk) => {
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
        if (code !== 0) {
          handleError(new Error(`mysql exited with code ${code}: ${error}`), 'MySQL process failed');
        } else {
          // Ensure all streams are properly closed before resolving
          const stream = inputStream as any;
          if (stream && typeof stream.destroy === 'function') {
            stream.destroy();
          }
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
        if (err.code === 'EPIPE') {
          // Don't immediately reject, wait for mysql process to close
          return;
        }
        handleError(err, 'MySQL stdin pipe error');
      });

      // Handle gunzip errors
      gunzip.on('error', (err) => {
        handleError(err, 'Decompression failed');
      });

      // Handle input stream errors
      inputStream.on('error', (err) => {
        handleError(err, 'Failed to read input stream');
      });

      // Set up the streaming pipeline: S3 → Gunzip → MySQL
      const pipeline = inputStream.pipe(gunzip);
      
      pipeline.on('error', (err) => {
        handleError(err, 'Pipeline error');
      });

      // Pipe to mysql with proper backpressure handling
      pipeline.pipe(mysql.stdin, { end: true });

      // Handle backpressure by pausing/resuming the input stream
      mysql.stdin.on('drain', () => {
        const stream = inputStream as any;
        if (stream && typeof stream.resume === 'function') {
          stream.resume();
        }
      });

      if (mysql.stdin.writableHighWaterMark && mysql.stdin.writableLength > mysql.stdin.writableHighWaterMark) {
        const stream = inputStream as any;
        if (stream && typeof stream.pause === 'function') {
          stream.pause();
        }
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
