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

      if (this.config.schemas && this.config.schemas.length > 0) {
        args.push('--databases', ...this.config.schemas);
      } else if (this.config.database) {
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
      let lastProgressUpdate = 0;

      const gunzip = zlib.createGunzip({
        chunkSize: 64 * 1024 // 64KB chunks for better performance
      });
      
      const mysql = spawn('mysql', [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        targetDatabase
      ], {
        stdio: ['pipe', 'inherit', 'pipe']
      });

      const input = fs.createReadStream(backupPath, {
        highWaterMark: 64 * 1024 // 64KB read buffer
      });
      let error = '';
      let isResolved = false;
      
      // Set a timeout for the entire operation (30 minutes)
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          input.destroy();
          gunzip.destroy();
          mysql.kill('SIGTERM');
          reject(new Error('Restore operation timed out after 30 minutes'));
        }
      }, 30 * 60 * 1000);

      const handleError = (err: Error & { code?: string }, source: string) => {
        if (!isResolved) {
          // Special handling for EPIPE errors
          if (err.code === 'EPIPE') {
            // EPIPE means the mysql process closed its stdin
            // Wait for the mysql process to exit and report its exit code
            // Don't reject immediately as this might be normal termination
            return;
          }
          
          isResolved = true;
          clearTimeout(timeoutId);
          input.destroy();
          gunzip.destroy();
          mysql.kill('SIGTERM');
          reject(new Error(`${source}: ${err.message}`));
        }
      };

      const handleSuccess = () => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          if (progressCallback) {
            progressCallback({ loaded: totalSize, total: totalSize, percentage: 100 });
          }
          resolve();
        }
      };

      // Track progress if callback provided - throttle updates for better performance
      if (progressCallback) {
        input.on('data', (chunk) => {
          processedBytes += chunk.length;
          const now = Date.now();
          // Only update progress every 100ms to avoid overwhelming the UI
          if (now - lastProgressUpdate > 100) {
            const percentage = (processedBytes / totalSize) * 100;
            progressCallback({ 
              loaded: processedBytes, 
              total: totalSize, 
              percentage 
            });
            lastProgressUpdate = now;
          }
        });
      }

      // Handle mysql process errors
      mysql.stderr.on('data', (data) => {
        error += data.toString();
      });

      mysql.on('error', (err) => {
        handleError(err as Error & { code?: string }, 'Failed to start mysql');
      });

      mysql.on('close', (code) => {
        if (!isResolved) {
          if (code !== 0) {
            isResolved = true;
            clearTimeout(timeoutId);
            reject(new Error(`MySQL process failed: mysql exited with code ${code}: ${error}`));
          } else {
            handleSuccess();
          }
        }
      });

      // Handle mysql stdin pipe errors (EPIPE protection)
      mysql.stdin.on('error', (err: Error & { code?: string }) => {
        handleError(err, 'MySQL stdin pipe error');
      });

      // Handle gunzip errors
      gunzip.on('error', (err) => {
        handleError(err as Error & { code?: string }, 'Decompression failed');
      });

      // Handle input file errors
      input.on('error', (err) => {
        handleError(err as Error & { code?: string }, 'Failed to read backup file');
      });

      // Pipe the streams manually with better error handling
      input.pipe(gunzip).on('error', (err: Error & { code?: string }) => {
        handleError(err, 'Gunzip pipe error');
      });

      gunzip.pipe(mysql.stdin).on('error', (err: Error & { code?: string }) => {
        handleError(err, 'MySQL stdin pipe error');
      });

      // Handle end of gunzip stream
      gunzip.on('end', () => {
        // Close mysql stdin when decompression is complete
        mysql.stdin.end();
      });
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
