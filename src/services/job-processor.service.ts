import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

export interface TranscriptJob {
  meetingId: number;
  segmentIds: number[];
  timeStart: string;
  timeEnd: string;
}

export type TranscriptProcessorCallback = (job: TranscriptJob) => Promise<void>;

interface QueuedJob {
  id: string;
  data: TranscriptJob;
  attempts: number;
  maxAttempts: number;
  addedAt: number;
}

@Injectable()
export class JobProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobProcessorService.name);

  // In-memory queue
  private queue: QueuedJob[] = [];
  private processing = false;
  private transcriptProcessor: TranscriptProcessorCallback | null = null;
  private jobIdCounter = 0;

  // Statistics
  private stats = {
    completed: 0,
    failed: 0,
  };

  // Configuration
  private readonly MAX_ATTEMPTS = 3;
  private readonly CONCURRENCY = 2;
  private readonly RETRY_DELAY = 1000; // 1 second base delay
  private activeJobs = 0;

  async onModuleInit() {
    this.logger.log('Initializing JobProcessorService with in-memory queue...');
    this.logger.log('JobProcessorService initialized successfully');
  }

  async onModuleDestroy() {
    this.logger.log('Shutting down JobProcessorService...');

    // Wait for active jobs to complete
    while (this.activeJobs > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.logger.log('JobProcessorService shut down complete');
  }

  /**
   * Add a transcript processing job to the queue
   */
  async addTranscriptProcessingJob(jobData: TranscriptJob): Promise<void> {
    try {
      const jobId = `job-${++this.jobIdCounter}`;
      const job: QueuedJob = {
        id: jobId,
        data: jobData,
        attempts: 0,
        maxAttempts: this.MAX_ATTEMPTS,
        addedAt: Date.now(),
      };

      this.queue.push(job);

      this.logger.log(
        `Added transcript processing job ${jobId} for meeting ${jobData.meetingId}. Queue size: ${this.queue.length}`,
      );

      // Start processing if not already running
      if (!this.processing) {
        this.processQueue();
      }
    } catch (error) {
      this.logger.error('Error adding transcript processing job:', error);
      throw error;
    }
  }

  /**
   * Register the processor callback (called by TranscriptsService)
   */
  setTranscriptProcessor(processor: TranscriptProcessorCallback): void {
    this.transcriptProcessor = processor;
    this.logger.log('Transcript processor callback registered');
  }

  /**
   * Process jobs from the queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0 || this.activeJobs > 0) {
      // Process jobs up to concurrency limit
      while (this.queue.length > 0 && this.activeJobs < this.CONCURRENCY) {
        const job = this.queue.shift();
        if (job) {
          this.activeJobs++;
          this.processJob(job).finally(() => {
            this.activeJobs--;
          });
        }
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.processing = false;
  }

  /**
   * Process a single job with retry logic
   */
  private async processJob(job: QueuedJob): Promise<void> {
    const { meetingId, segmentIds } = job.data;
    job.attempts++;

    this.logger.log(
      `Processing job ${job.id} for meeting ${meetingId} with ${segmentIds.length} segments (attempt ${job.attempts}/${job.maxAttempts})`,
    );

    if (!this.transcriptProcessor) {
      this.logger.warn('Transcript processor not registered, skipping job');
      this.stats.failed++;
      return;
    }

    try {
      // Call the registered processor
      await this.transcriptProcessor(job.data);

      this.stats.completed++;
      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(`Job ${job.id} failed (attempt ${job.attempts}):`, error);

      // Retry logic with exponential backoff
      if (job.attempts < job.maxAttempts) {
        const delay = this.RETRY_DELAY * Math.pow(2, job.attempts - 1);
        this.logger.log(`Retrying job ${job.id} in ${delay}ms...`);

        await new Promise(resolve => setTimeout(resolve, delay));

        // Re-queue the job
        this.queue.push(job);
      } else {
        this.stats.failed++;
        this.logger.error(`Job ${job.id} failed after ${job.maxAttempts} attempts`);
      }
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats() {
    return {
      waiting: this.queue.length,
      active: this.activeJobs,
      completed: this.stats.completed,
      failed: this.stats.failed,
      total: this.queue.length + this.activeJobs,
    };
  }
}
