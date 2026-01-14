import { MySQLManager } from '../../modules/mysql';
import { S3Manager } from '../../modules/s3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { createConnection, Connection, createPool, Pool } from 'mysql2/promise';

// Extended timeout for large database operations (60 minutes)
jest.setTimeout(3600000);

// Default to 10GB for thorough testing, use LARGE_DB_SIZE_GB env var to override
const TARGET_SIZE_GB = parseInt(process.env.LARGE_DB_SIZE_GB || '10', 10);
const TARGET_SIZE_BYTES = TARGET_SIZE_GB * 1024 * 1024 * 1024;

// Parallel connections for faster inserts (more = faster but more memory)
const PARALLEL_CONNECTIONS = parseInt(process.env.PARALLEL_CONNECTIONS || '8', 10);

describe(`Large Database Integration Tests (${TARGET_SIZE_GB}GB)`, () => {
  let connection: Connection;
  let pool: Pool;
  let s3Manager: S3Manager;

  const testConfig = {
    database: {
      host: process.env.MYSQL_HOST!,
      port: parseInt(process.env.MYSQL_PORT!),
      user: process.env.MYSQL_USER!,
      password: process.env.MYSQL_PASSWORD!,
      database: process.env.MYSQL_DATABASE!
    },
    s3: {
      bucket: process.env.S3_BUCKET!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      endpointUrl: process.env.S3_ENDPOINT_URL!,
      forcePathStyle: true
    }
  };

  // Connection settings optimized for large data operations
  const MYSQL_CONNECTION_OPTIONS = {
    host: testConfig.database.host,
    port: testConfig.database.port,
    user: 'root',
    password: process.env.MYSQL_ROOT_PASSWORD!,
    connectTimeout: 60000,
    multipleStatements: true,
    // Connection pool settings for parallel inserts
    connectionLimit: PARALLEL_CONNECTIONS + 2,
    waitForConnections: true
  };

  beforeAll(async () => {
    console.log('[Setup] Initializing S3Manager...');
    s3Manager = new S3Manager(testConfig.s3);

    console.log('[Setup] Waiting for services...');
    await waitForServices();

    console.log('[Setup] Creating MySQL connection pool...');
    pool = createPool(MYSQL_CONNECTION_OPTIONS);
    connection = await createConnection(MYSQL_CONNECTION_OPTIONS);

    // Set session variables for large data handling
    console.log('[Setup] Configuring MySQL session for large data...');
    try {
      await connection.execute('SET SESSION net_read_timeout = 600');
      await connection.execute('SET SESSION net_write_timeout = 600');
      await connection.execute('SET SESSION wait_timeout = 28800');
      console.log('[Setup] MySQL session configured successfully');
    } catch (err) {
      console.log('[Setup] Warning: Some session variables could not be set (may require server config)');
    }
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (connection) {
      await connection.end();
    }
  });

  it(`should handle ${TARGET_SIZE_GB}GB database backup and restore`, async () => {
    const sourceDb = 'large_test_db';
    const targetDb = 'large_test_db_restored';

    console.log(`\n=== Starting ${TARGET_SIZE_GB}GB Database Test (${PARALLEL_CONNECTIONS} parallel connections) ===\n`);

    // Clean up any existing test databases
    await connection.execute(`DROP DATABASE IF EXISTS ${sourceDb}`);
    await connection.execute(`DROP DATABASE IF EXISTS ${targetDb}`);

    // Create source database
    await connection.execute(`CREATE DATABASE ${sourceDb}`);
    await connection.query(`USE ${sourceDb}`);

    // Create table with large data columns
    await connection.execute(`
      CREATE TABLE large_data (
        id INT PRIMARY KEY AUTO_INCREMENT,
        data_blob LONGBLOB,
        text_data LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created (created_at)
      )
    `);

    // Generate large data using parallel inserts for speed
    // Each row: ~100KB (50KB blob + 50KB text)
    // Each batch: 50 rows = ~5MB per INSERT
    const BLOB_SIZE = 50 * 1024;    // 50KB blob per row
    const TEXT_SIZE = 50 * 1024;    // 50KB text per row
    const ROW_SIZE = BLOB_SIZE + TEXT_SIZE; // ~100KB per row
    const BATCH_SIZE = 50;          // 50 rows per INSERT (~5MB per statement)
    const TOTAL_ROWS = Math.ceil(TARGET_SIZE_BYTES / ROW_SIZE);
    const TOTAL_BATCHES = Math.ceil(TOTAL_ROWS / BATCH_SIZE);

    console.log(`[DataGen] Configuration:`);
    console.log(`  - Target size: ${TARGET_SIZE_GB}GB (${TARGET_SIZE_BYTES.toLocaleString()} bytes)`);
    console.log(`  - Row size: ${(ROW_SIZE / 1024).toFixed(0)}KB`);
    console.log(`  - Batch size: ${BATCH_SIZE} rows (~${(BATCH_SIZE * ROW_SIZE / 1024 / 1024).toFixed(1)}MB per INSERT)`);
    console.log(`  - Total rows: ${TOTAL_ROWS.toLocaleString()}`);
    console.log(`  - Total batches: ${TOTAL_BATCHES.toLocaleString()}`);
    console.log(`  - Parallel connections: ${PARALLEL_CONNECTIONS}`);
    console.log('');

    // Pre-generate reusable data buffers for speed (no need for truly random data)
    console.log('[DataGen] Pre-generating data buffers...');
    const pregenBlob = crypto.randomBytes(BLOB_SIZE);
    const pregenText = crypto.randomBytes(TEXT_SIZE).toString('base64').substring(0, TEXT_SIZE);
    console.log('[DataGen] Buffers ready, starting parallel inserts...');

    let batchesCompleted = 0;
    const startTime = Date.now();
    let lastLogTime = startTime;

    // Process batches in parallel chunks
    const processBatch = async (batchIndex: number): Promise<number> => {
      const rowsInBatch = Math.min(BATCH_SIZE, TOTAL_ROWS - batchIndex * BATCH_SIZE);
      if (rowsInBatch <= 0) return 0;

      const placeholders = Array(rowsInBatch).fill('(?, ?)').join(', ');
      const values: (string | Buffer)[] = [];

      for (let i = 0; i < rowsInBatch; i++) {
        // Reuse pre-generated data with slight variation (append index)
        values.push(pregenBlob, pregenText);
      }

      const conn = await pool.getConnection();
      try {
        await conn.execute(
          `INSERT INTO ${sourceDb}.large_data (data_blob, text_data) VALUES ${placeholders}`,
          values
        );
        return rowsInBatch * ROW_SIZE;
      } finally {
        conn.release();
      }
    };

    // Run batches in parallel groups
    let bytesGenerated = 0;
    for (let i = 0; i < TOTAL_BATCHES; i += PARALLEL_CONNECTIONS) {
      const batchPromises: Promise<number>[] = [];
      for (let j = 0; j < PARALLEL_CONNECTIONS && (i + j) < TOTAL_BATCHES; j++) {
        batchPromises.push(processBatch(i + j));
      }

      try {
        const results = await Promise.all(batchPromises);
        bytesGenerated += results.reduce((a, b) => a + b, 0);
        batchesCompleted += batchPromises.length;
      } catch (insertError) {
        console.error(`[DataGen] ERROR in parallel batch group starting at ${i}: ${insertError}`);
        throw insertError;
      }

      // Progress reporting every 2 seconds
      const now = Date.now();
      if (now - lastLogTime > 2000 || batchesCompleted >= TOTAL_BATCHES) {
        const elapsedSec = (now - startTime) / 1000;
        const gbGenerated = bytesGenerated / (1024 * 1024 * 1024);
        const rate = elapsedSec > 0 ? (gbGenerated / elapsedSec * 60) : 0;
        const pctComplete = (batchesCompleted / TOTAL_BATCHES * 100).toFixed(1);
        const remainingBatches = TOTAL_BATCHES - batchesCompleted;
        const batchesPerSec = batchesCompleted / elapsedSec;
        const eta = batchesPerSec > 0 ? (remainingBatches / batchesPerSec / 60).toFixed(1) : '?';
        console.log(
          `[DataGen] ${pctComplete}% | ${batchesCompleted}/${TOTAL_BATCHES} batches | ` +
          `${gbGenerated.toFixed(2)}GB | ${rate.toFixed(1)} GB/min | ETA: ${eta}min`
        );
        lastLogTime = now;
      }
    }

    const genDuration = (Date.now() - startTime) / 1000;
    console.log(`\n[DataGen] Complete: ${(bytesGenerated / (1024 * 1024 * 1024)).toFixed(2)}GB in ${genDuration.toFixed(0)}s\n`);

    // Verify row count
    console.log('[Verify] Counting rows...');
    const [countResult] = await connection.execute('SELECT COUNT(*) as count FROM large_data');
    const rowCount = (countResult as any[])[0].count;
    console.log(`[Verify] Total rows: ${rowCount.toLocaleString()}`);

    // Create backup
    console.log('\n=== Starting Backup ===\n');
    const tempBackupPath = path.join(os.tmpdir(), `large-backup-${Date.now()}.sql.gz`);
    const sourceManager = new MySQLManager({
      ...testConfig.database,
      database: sourceDb
    });

    let lastBackupProgress = 0;
    const backupStartTime = Date.now();
    await sourceManager.createBackup(tempBackupPath, (progress) => {
      const loaded = progress.loaded ?? 0;
      const gbProcessed = loaded / (1024 * 1024 * 1024);
      if (gbProcessed - lastBackupProgress >= 0.5) {
        console.log(`Backup progress: ${gbProcessed.toFixed(2)}GB`);
        lastBackupProgress = gbProcessed;
      }
    });

    const backupDuration = (Date.now() - backupStartTime) / 1000;
    const backupStats = fs.statSync(tempBackupPath);
    const backupSizeGB = backupStats.size / (1024 * 1024 * 1024);
    console.log(`\nBackup complete: ${backupSizeGB.toFixed(2)}GB in ${backupDuration.toFixed(0)}s`);
    console.log(`Compression ratio: ${((1 - backupStats.size / bytesGenerated) * 100).toFixed(1)}%`);

    // Verify backup file is substantial
    expect(backupStats.size).toBeGreaterThan(100 * 1024 * 1024); // At least 100MB

    // Upload to S3
    console.log('\n=== Starting S3 Upload ===\n');
    const backupKey = `large-test-${Date.now()}.sql.gz`;
    let lastUploadProgress = 0;
    const uploadStartTime = Date.now();

    await s3Manager.uploadFile(tempBackupPath, backupKey, (progress) => {
      const loaded = progress.loaded ?? 0;
      const percentage = progress.percentage ?? 0;
      const gbUploaded = loaded / (1024 * 1024 * 1024);
      if (gbUploaded - lastUploadProgress >= 0.1 || percentage >= 100) {
        console.log(
          `Upload progress: ${gbUploaded.toFixed(2)}GB / ${backupSizeGB.toFixed(2)}GB ` +
          `(${percentage.toFixed(1)}%)`
        );
        lastUploadProgress = gbUploaded;
      }
    });

    const uploadDuration = (Date.now() - uploadStartTime) / 1000;
    console.log(`\nUpload complete in ${uploadDuration.toFixed(0)}s`);
    console.log(`Upload speed: ${(backupSizeGB / uploadDuration * 60).toFixed(2)} GB/min`);

    // Clean up local backup file
    fs.unlinkSync(tempBackupPath);

    // Verify backup exists in S3
    const backupExists = await s3Manager.backupExists(backupKey);
    expect(backupExists).toBe(true);

    // Download from S3
    console.log('\n=== Starting S3 Download ===\n');
    const tempRestorePath = path.join(os.tmpdir(), `large-restore-${Date.now()}.sql.gz`);
    let lastDownloadProgress = 0;
    const downloadStartTime = Date.now();

    await s3Manager.downloadFile(backupKey, tempRestorePath, (progress) => {
      const loaded = progress.loaded ?? 0;
      const percentage = progress.percentage ?? 0;
      const gbDownloaded = loaded / (1024 * 1024 * 1024);
      if (gbDownloaded - lastDownloadProgress >= 0.1 || percentage >= 100) {
        console.log(
          `Download progress: ${gbDownloaded.toFixed(2)}GB / ${backupSizeGB.toFixed(2)}GB ` +
          `(${percentage.toFixed(1)}%)`
        );
        lastDownloadProgress = gbDownloaded;
      }
    });

    const downloadDuration = (Date.now() - downloadStartTime) / 1000;
    console.log(`\nDownload complete in ${downloadDuration.toFixed(0)}s`);
    console.log(`Download speed: ${(backupSizeGB / downloadDuration * 60).toFixed(2)} GB/min`);

    // Verify downloaded file size matches
    const downloadedStats = fs.statSync(tempRestorePath);
    expect(downloadedStats.size).toBe(backupStats.size);

    // Restore to new database
    console.log('\n=== Starting Restore ===\n');
    const restoreManager = new MySQLManager({
      ...testConfig.database,
      database: targetDb
    });

    let lastRestoreProgress = 0;
    const restoreStartTime = Date.now();
    await restoreManager.restoreBackup(tempRestorePath, targetDb, (progress) => {
      const loaded = progress.loaded ?? 0;
      const gbRestored = loaded / (1024 * 1024 * 1024);
      if (gbRestored - lastRestoreProgress >= 0.5) {
        console.log(`Restore progress: ${gbRestored.toFixed(2)}GB`);
        lastRestoreProgress = gbRestored;
      }
    });

    const restoreDuration = (Date.now() - restoreStartTime) / 1000;
    console.log(`\nRestore complete in ${restoreDuration.toFixed(0)}s`);

    // Clean up restore file
    fs.unlinkSync(tempRestorePath);

    // Verify data integrity
    console.log('\n=== Verifying Data Integrity ===\n');
    await connection.query(`USE ${targetDb}`);

    const [restoredCount] = await connection.execute('SELECT COUNT(*) as count FROM large_data');
    const restoredRowCount = (restoredCount as any[])[0].count;
    console.log(`Restored rows: ${restoredRowCount}`);
    expect(restoredRowCount).toBe(rowCount);

    // Verify some sample data
    const [sampleRows] = await connection.execute(
      'SELECT id, LENGTH(data_blob) as blob_len, LENGTH(text_data) as text_len FROM large_data LIMIT 10'
    );
    for (const row of sampleRows as any[]) {
      expect(row.blob_len).toBeGreaterThan(0);
      expect(row.text_len).toBeGreaterThan(0);
    }

    // Clean up test databases
    console.log('\n=== Cleanup ===\n');
    await connection.execute(`DROP DATABASE IF EXISTS ${sourceDb}`);
    await connection.execute(`DROP DATABASE IF EXISTS ${targetDb}`);

    // Summary
    const totalDuration = (Date.now() - startTime) / 1000;
    console.log('=== Test Summary ===');
    console.log(`Total test duration: ${(totalDuration / 60).toFixed(1)} minutes`);
    console.log(`Data generated: ${(bytesGenerated / (1024 * 1024 * 1024)).toFixed(2)}GB`);
    console.log(`Backup size: ${backupSizeGB.toFixed(2)}GB`);
    console.log(`Rows processed: ${rowCount}`);
    console.log('====================\n');
  });

  // Helper functions
  async function waitForServices(maxRetries = 30, interval = 2000): Promise<void> {
    console.log('Waiting for services to be ready...');

    for (let i = 0; i < maxRetries; i++) {
      try {
        const testConnection = await createConnection({
          host: testConfig.database.host,
          port: testConfig.database.port,
          user: testConfig.database.user,
          password: testConfig.database.password,
          connectTimeout: 5000
        });
        await testConnection.ping();
        await testConnection.end();

        await s3Manager.listBackups();

        console.log('Services ready\n');
        return;
      } catch {
        console.log(`Waiting... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, interval));
      }
    }

    throw new Error('Services did not become ready within timeout');
  }
});
