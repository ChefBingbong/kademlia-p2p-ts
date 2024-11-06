import { ScheduledTask, schedule } from "node-cron";

export enum Schedules {
	Fast = "*/15 * * * * *",
	Slow = "*/30 * * * * *",
}
export type SchedulerInfo = {
	start: number;
	chnageTime: number;
};

interface DiscoverySchedulerOpions {
	jobId: string;
}
export class DiscoveryScheduler {
	public schedule: string;
	public cronJob: ScheduledTask | undefined;

	public readonly jobId: string;
	public readonly process: NodeJS.Process;

	constructor({ jobId }: DiscoverySchedulerOpions) {
		this.jobId = jobId;
		this.process = process;
		this.schedule = Schedules.Fast;
	}

	public createSchedule(interval: string, callback: () => Promise<void>) {
		this.schedule = interval;
		this.cronJob = schedule(interval, async () => callback());
	}

	public stopCronJob = (): void => {
		this.cronJob.stop();
	};

	public startCronJob = (): void => {
		if (this.cronJob) this.cronJob.start();
	};

	public setSchedule = (schedule: string): void => {
		this.schedule = schedule;
	};

	public handleExit = (): void => {
		this.stopCronJob();
		console.log(`Stopping ${this.jobId} cron job and closing server...`);
		this.process.exit(0);
	};

	public handleError = (err: Error): void => {
		this.stopCronJob();
		console.error(`Unhandled error: ${err.message}`);
		this.process.exit(1);
	};

	public initialize = (): void => {
		this.process.on("unhandledRejection", this.handleError);
		this.process.on("uncaughtException", this.handleError);
		this.process.on("SIGINT", this.handleExit);
		this.process.on("SIGTERM", this.handleExit);
	};

	public getNewSchedule = (isEstablished: boolean) => {
		return isEstablished && this.schedule === Schedules.Fast ? Schedules.Slow : Schedules.Fast;
	};
}
