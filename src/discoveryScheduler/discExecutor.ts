import { AppLogger } from "../logging/logger";
import { extractError } from "../utils/extractError";

export class JobExecutor extends AppLogger {
  private static jobQueue: Array<{
    id: string;
    jobFunction: () => Promise<any>;
  }> = [];
  private static isJobRunning = false;
  private static log: any;

  constructor() {
    super("disc-logger", false);
    JobExecutor.log = this.logger;
  }

  public static async addToQueue(
    jobId: string,
    jobFunction: () => Promise<any>
  ) {
    if (!this.jobQueue.find((job) => job.id === jobId)) {
      this.jobQueue.push({ id: jobId, jobFunction });
    }
    this.runJobsSequentially();
  }

  private static async runJobsSequentially() {
    if (!this.isJobRunning && this.jobQueue.length > 0) {
      this.isJobRunning = true;
      const { id, jobFunction } = this.jobQueue.shift()!;
      try {
        await jobFunction();
      } catch (error) {
        const errorMessage = extractError(error);
        this.log(`Error in job ${id}: `, errorMessage);
      } finally {
        this.isJobRunning = false;
        this.runJobsSequentially();
      }
    }
  }
}
