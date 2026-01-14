import { spawn } from 'child_process';
import { createConnection } from 'mysql2/promise';
import * as zlib from 'zlib';
import * as fs from 'fs';
import { DatabaseConfig, ProgressCallback } from '../types';

// Constants for large database handling (supports databases up to 400GB+)
const MAX_ALLOWED_PACKET = '1G';
const MAX_ALLOWED_PACKET_BYTES = 1024 * 1024 * 1024; // 1GB in bytes
const NET_BUFFER_LENGTH = '16M'; // 16MB batches - works with MySQL 8.0 default (64MB max_allowed_packet)
// Stream buffer sizes optimized for large data
const STREAM_HIGH_WATER_MARK = 16 * 1024 * 1024; // 16MB chunks
const GZIP_CHUNK_SIZE = 4 * 1024 * 1024; // 4MB gzip chunks
// Timeout: 1 minute per GB, minimum 30 minutes
const TIMEOUT_PER_GB_MS = 60 * 1000;
const MIN_TIMEOUT_MS = 30 * 60 * 1000;

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

  /**
   * Attempts to set max_allowed_packet to 1GB globally.
   * Returns true if successful (user has admin privileges), false otherwise.
   */
  public async trySetMaxAllowedPacket(): Promise<boolean> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password
    });

    try {
      // Try to set global max_allowed_packet (requires SUPER or SYSTEM_VARIABLES_ADMIN privilege)
      await connection.execute(`SET GLOBAL max_allowed_packet = ${MAX_ALLOWED_PACKET_BYTES}`);
      console.log('[MySQL] Successfully set max_allowed_packet to 1GB (admin privileges available)');
      return true;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Access denied') || errorMessage.includes('SUPER privilege') || errorMessage.includes('SYSTEM_VARIABLES_ADMIN')) {
        console.log('[MySQL] Cannot set max_allowed_packet globally (no admin privileges) - using fallback net_buffer_length');
      } else {
        console.log(`[MySQL] Warning: Could not set max_allowed_packet: ${errorMessage}`);
      }
      return false;
    } finally {
      await connection.end();
    }
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
      // Build mysqldump arguments optimized for large databases (400GB+)
      // These flags are compatible with MySQL 5.6+ and MariaDB
      const args = [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        // Large database optimizations
        `--max_allowed_packet=${MAX_ALLOWED_PACKET}`,
        `--net_buffer_length=${NET_BUFFER_LENGTH}`,
        '--quick',                    // Stream tables row-by-row instead of buffering
        '--single-transaction',       // Consistent backup for InnoDB without locking
        '--routines',                 // Include stored procedures and functions
        '--triggers',                 // Include triggers
        '--lock-tables=false',        // Don't lock tables (use single-transaction instead)
        '--verbose'
      ];

      if (this.config.schemas && this.config.schemas.length > 0) {
        args.push('--databases', ...this.config.schemas);
      } else if (this.config.database) {
        args.push(this.config.database);
      } else {
        args.push('--all-databases');
      }

      const mysqldump = spawn('mysqldump', args, {
        // Use larger buffers for stdout
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      // Use larger gzip chunks for better performance with large data
      const gzip = zlib.createGzip({
        chunkSize: GZIP_CHUNK_SIZE,
        level: 6  // Balanced compression level
      });

      const output = fs.createWriteStream(outputPath, {
        highWaterMark: STREAM_HIGH_WATER_MARK
      });

      let totalBytes = 0;
      let error = '';
      let lastProgressUpdate = 0;

      // Track progress if callback provided - throttle for performance
      if (progressCallback) {
        gzip.on('data', (chunk) => {
          totalBytes += chunk.length;
          const now = Date.now();
          // Update progress every 500ms to avoid overwhelming the UI
          if (now - lastProgressUpdate > 500) {
            progressCallback({ loaded: totalBytes });
            lastProgressUpdate = now;
          }
        });
      }

      // Handle mysqldump errors - filter out warnings
      mysqldump.stderr.on('data', (data) => {
        const msg = data.toString();
        // Filter out common warnings that aren't actual errors
        if (!msg.includes('Warning:') && !msg.includes('-- Dumping')) {
          error += msg;
        }
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

  public async createDatabase(databaseName: string): Promise<void> {
    const connection = await createConnection({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      multipleStatements: true
    });

    try {
      // Use backticks to handle special characters in database names
      await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\``);
      console.log(`Database '${databaseName}' created or already exists`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create database '${databaseName}': ${errorMessage}`);
    } finally {
      await connection.end();
    }
  }

  public async restoreBackup(backupPath: string, targetDatabase: string, progressCallback?: ProgressCallback): Promise<void> {
    // Check if database exists, create if it doesn't
    try {
      const dbExists = await this.databaseExists(targetDatabase);
      if (!dbExists) {
        console.log(`Database '${targetDatabase}' does not exist, creating...`);
        await this.createDatabase(targetDatabase);
        // Verify it was created
        const dbExistsAfter = await this.databaseExists(targetDatabase);
        if (!dbExistsAfter) {
          throw new Error(`Failed to create database '${targetDatabase}'`);
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Database preparation failed: ${errorMessage}`);
    }

    // Try to set max_allowed_packet globally for large database support
    const hasAdminPrivileges = await this.trySetMaxAllowedPacket();

    return new Promise((resolve, reject) => {
      if (!fs.existsSync(backupPath)) {
        reject(new Error(`Backup file not found: ${backupPath}`));
        return;
      }

      const stats = fs.statSync(backupPath);
      const totalSize = stats.size;
      let processedBytes = 0;
      let lastProgressUpdate = 0;

      // Calculate dynamic timeout based on file size (1 min per GB, minimum 30 min)
      const fileSizeGB = totalSize / (1024 * 1024 * 1024);
      const dynamicTimeout = Math.max(MIN_TIMEOUT_MS, fileSizeGB * TIMEOUT_PER_GB_MS);

      // Use larger gunzip chunks for better performance with large data
      const gunzip = zlib.createGunzip({
        chunkSize: GZIP_CHUNK_SIZE
      });

      // Build init command based on whether we have admin privileges
      // If we have admin privileges, we already set max_allowed_packet globally
      // If not, we rely on the server's default (and use smaller batches during backup)
      const initCommand = hasAdminPrivileges
        ? 'SET max_allowed_packet=1073741824; SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET AUTOCOMMIT=0;'
        : 'SET FOREIGN_KEY_CHECKS=0; SET UNIQUE_CHECKS=0; SET AUTOCOMMIT=0;';

      console.log(`[MySQL] Starting restore with${hasAdminPrivileges ? '' : 'out'} admin privileges`);

      // Build mysql arguments optimized for large databases
      const mysql = spawn('mysql', [
        '-h', this.config.host,
        '-P', this.config.port.toString(),
        '-u', this.config.user,
        `-p${this.config.password}`,
        // Large database optimizations
        `--max_allowed_packet=${MAX_ALLOWED_PACKET}`,
        `--net_buffer_length=${NET_BUFFER_LENGTH}`,
        `--init-command=${initCommand}`,
        targetDatabase
      ], {
        stdio: ['pipe', 'inherit', 'pipe']
      });

      // Use larger read buffers for better throughput
      const input = fs.createReadStream(backupPath, {
        highWaterMark: STREAM_HIGH_WATER_MARK
      });
      let error = '';
      let isResolved = false;

      // Set dynamic timeout based on file size
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          input.destroy();
          gunzip.destroy();
          mysql.kill('SIGTERM');
          const timeoutMinutes = Math.round(dynamicTimeout / 60000);
          reject(new Error(`Restore operation timed out after ${timeoutMinutes} minutes`));
        }
      }, dynamicTimeout);

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
