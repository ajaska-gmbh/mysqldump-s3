import * as cliProgress from 'cli-progress';
import chalk from 'chalk';
import { ProgressCallback } from '../types';

export class ProgressTracker {
  private progressBar: cliProgress.SingleBar | null = null;
  private isActive = false;
  private currentValue = 0;
  private totalValue = 0;
  private lastUpdateTime = 0;
  private lastUpdateValue = 0;
  private progressRates: number[] = [];
  private readonly maxRateHistory = 10;
  private readonly minUpdateInterval = 500; // milliseconds

  public createProgressBar(label: string, total?: number): ProgressCallback {
    this.progressBar = new cliProgress.SingleBar({
      format: (options, params, payload) => {
        const p = params as any;
        const etaStr = p.eta !== null && p.percentage < 100 
          ? `ETA: ${p.eta}s` 
          : p.percentage === 100 ? 'Complete' : 'Calculating...';
        return `${chalk.cyan(label)} |${p.bar}| ${p.percentage}% | ${p.value}/${p.total} | ${etaStr}`;
      },
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true,
      etaBuffer: this.maxRateHistory,
      etaAsynchronousUpdate: true
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
    this.lastUpdateTime = Date.now();
    this.lastUpdateValue = 0;
    this.progressRates = [];

    return (progress) => {
      if (!this.progressBar || !this.isActive) return;

      const now = Date.now();
      const timeSinceLastUpdate = now - this.lastUpdateTime;

      // Throttle updates to prevent too frequent changes
      if (timeSinceLastUpdate < this.minUpdateInterval && progress.percentage !== 100) {
        return;
      }

      let newValue: number;
      let newTotal: number = this.totalValue;

      if (progress.total !== undefined && progress.loaded !== undefined) {
        newTotal = progress.total;
        newValue = progress.loaded;
        if (newTotal !== this.totalValue) {
          this.totalValue = newTotal;
          this.progressBar.setTotal(newTotal);
        }
      } else if (progress.percentage !== undefined) {
        newValue = progress.percentage;
        newTotal = this.totalValue; // Keep existing total
      } else {
        return;
      }

      // Calculate and smooth the progress rate
      if (this.lastUpdateTime > 0 && timeSinceLastUpdate > 0) {
        const valueChange = newValue - this.lastUpdateValue;
        const rate = valueChange / (timeSinceLastUpdate / 1000); // units per second

        if (rate > 0) {
          this.progressRates.push(rate);
          if (this.progressRates.length > this.maxRateHistory) {
            this.progressRates.shift();
          }
        }
      }

      this.currentValue = newValue;
      this.lastUpdateTime = now;
      this.lastUpdateValue = newValue;

      // Update the progress bar
      this.progressBar.update(newValue);
    };
  }

  public createStreamProgressBar(label: string): ProgressCallback {
    let lastUpdate = 0;
    const updateThreshold = 1024 * 1024; // Update every 1MB

    return (progress) => {
      const loaded = progress.loaded || 0;
      if (loaded - lastUpdate >= updateThreshold || progress.percentage === 100) {
        const sizeStr = this.formatBytes(loaded);
        const totalStr = progress.total ? this.formatBytes(progress.total) : 'unknown';
        const percentage = progress.percentage || 0;

        process.stdout.write(`\r${chalk.cyan(label)} ${sizeStr}/${totalStr} (${percentage.toFixed(1)}%)`);

        if (progress.percentage === 100) {
          process.stdout.write('\n');
        }

        lastUpdate = loaded;
      }
    };
  }

  public stop(): void {
    if (this.progressBar && this.isActive) {
      this.progressBar.stop();
      this.isActive = false;
      this.progressRates = [];
      this.lastUpdateTime = 0;
      this.lastUpdateValue = 0;
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
