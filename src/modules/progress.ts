import * as cliProgress from 'cli-progress';
import * as chalk from 'chalk';
import { ProgressCallback } from '../types';

export class ProgressTracker {
  private progressBar: cliProgress.SingleBar | null = null;
  private isActive = false;
  private currentValue = 0;
  private totalValue = 0;

  public createProgressBar(label: string, total?: number): ProgressCallback {
    this.progressBar = new cliProgress.SingleBar({
      format: `${chalk.cyan(label)} |{bar}| {percentage}% | {value}/{total} | ETA: {eta}s`,
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
    });

    if (total) {
      this.totalValue = total;
      this.progressBar.start(total, 0);
    } else {
      this.totalValue = 100;
      this.progressBar.start(100, 0);
    }
    
    this.currentValue = 0;
    this.isActive = true;

    return (progress) => {
      if (!this.progressBar || !this.isActive) return;

      if (total && progress.total) {
        this.totalValue = progress.total;
        this.progressBar.setTotal(progress.total);
        this.currentValue = progress.loaded;
        this.progressBar.update(progress.loaded);
      } else if (progress.percentage !== undefined) {
        this.currentValue = progress.percentage;
        this.progressBar.update(progress.percentage);
      }
    };
  }

  public createStreamProgressBar(label: string): ProgressCallback {
    let lastUpdate = 0;
    const updateThreshold = 1024 * 1024; // Update every 1MB

    return (progress) => {
      if (progress.loaded - lastUpdate >= updateThreshold || progress.percentage === 100) {
        const sizeStr = this.formatBytes(progress.loaded);
        const totalStr = progress.total ? this.formatBytes(progress.total) : 'unknown';
        const percentage = progress.percentage || 0;
        
        process.stdout.write(`\r${chalk.cyan(label)} ${sizeStr}/${totalStr} (${percentage.toFixed(1)}%)`);
        
        if (progress.percentage === 100) {
          process.stdout.write('\n');
        }
        
        lastUpdate = progress.loaded;
      }
    };
  }

  public stop(): void {
    if (this.progressBar && this.isActive) {
      this.progressBar.stop();
      this.isActive = false;
    }
  }

  public log(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (this.isActive) {
      // Stop progress bar temporarily for logging
      this.progressBar?.stop();
    }

    const prefix = {
      info: chalk.blue('ℹ'),
      warn: chalk.yellow('⚠'),
      error: chalk.red('✗')
    }[level];

    console.log(`${prefix} ${message}`);

    if (this.isActive && this.progressBar) {
      // Resume progress bar
      this.progressBar.start(this.totalValue, this.currentValue);
    }
  }

  private formatBytes(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

export const progressTracker = new ProgressTracker();