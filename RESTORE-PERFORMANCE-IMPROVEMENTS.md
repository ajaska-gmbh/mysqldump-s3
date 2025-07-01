# Database Restore Performance Improvements

## Issue
The original implementation of the database restore functionality was very slow, with a 400MB dump taking approximately 2 hours to restore.

## Solution
Several optimizations have been implemented to significantly improve the performance of the database restore process:

### 1. MySQL Performance Flags
Added the following MySQL performance flags to the `mysql` command:
- `--max_allowed_packet=1G`: Increases the maximum packet size to 1GB, allowing larger chunks of data to be processed at once.
- `--net_buffer_length=1000000`: Increases the buffer size for network operations.
- `--force`: Continues the import even if non-critical errors occur, making the process more resilient.

### 2. MySQL Session Variables
Set the following session variables to optimize import performance:
- `SET SESSION foreign_key_checks=0`: Disables foreign key checks during import, which significantly speeds up the process.
- `SET SESSION unique_checks=0`: Disables unique checks during import, which reduces the overhead of index updates.
- `SET SESSION autocommit=0`: Disables autocommit to reduce transaction overhead.
- `SET SESSION sql_log_bin=0`: Disables binary logging during import, which can significantly improve performance.

### 3. Improved Progress Tracking
Enhanced the progress tracking to provide more accurate feedback during the restoration process:
- Now tracks progress based on the decompressed data size rather than the compressed file size.
- Dynamically adjusts the total size estimate based on the observed compression ratio.
- Provides more accurate percentage completion information.

### 4. Proper Cleanup
Added code to reset MySQL session variables to their default values after the import is complete:
- Re-enables foreign key checks, unique checks, autocommit, and binary logging.
- Commits any pending transactions in the target database.

## Expected Performance Improvement
With these optimizations, the restore time for a 400MB dump is expected to be reduced from 2 hours to approximately 10-15 minutes, depending on the server hardware and network conditions.

## Testing
A test script (`test-restore-performance.sh`) has been provided to verify the performance improvements. This script:
1. Creates a test database
2. Runs the restore command with timing
3. Outputs the time taken for the restore process

Run this script before and after applying the changes to see the difference in performance.

## Technical Details
The optimizations work by:
1. Reducing disk I/O by disabling certain consistency checks during the import.
2. Increasing buffer sizes to allow more data to be processed in memory.
3. Reducing transaction overhead by disabling autocommit.
4. Reducing logging overhead by disabling binary logging.

These optimizations are particularly effective for large database dumps, where the overhead of consistency checks and logging can significantly impact performance.

## Compatibility
The optimizations use session variables where possible to avoid requiring SUPER privileges. This ensures that the optimizations work even if the user doesn't have elevated privileges on the MySQL server.