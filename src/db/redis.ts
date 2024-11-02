import Redis from "ioredis";
import { Logger } from "winston";
import { AppLogger } from "../logging/logger";

let enableRedis = true;

export class RedisClient {
	private readonly client: Redis;
	public static log: Logger = new AppLogger("redis-client", false).logger;

	constructor(client: Redis) {
		this.client = client;
	}

	public static async initialize(): Promise<RedisClient> {
		const client = new Redis("127.0.0.1:6379", {
			reconnectOnError(err) {
				enableRedis = false;
				if (process.env.NODE_ENV === "test") {
					return false;
				}
				this.log.error(err, "[Redis] reconnectOnError");
				return true;
			},
		});

		client.on("connect", () => this.log.info("Redis Client is connect"));
		client.on("reconnecting", () => this.log.info("Redis Client is reconnecting"));
		client.on("ready", () => this.log.info("Redis Client is ready"));

		client.on("error", (err) => {
			this.log.error(`Redis Client Error. Error: ${err}.`);
			this.log.error(`If you are on local dev make sure redis is running. use redis-server to start redis`);
		});

		return new RedisClient(client);
	}

	getClient(): Redis {
		return this.client;
	}

	async getSingleData<T>(key: string): Promise<T | null> {
		try {
			const res = await this.client.get(key);
			if (res) {
				return JSON.parse(res);
			}
			return null;
		} catch (error) {
			console.log(error);
		}
	}

	async setSignleData<T>(key: string, data: T): Promise<void> {
		try {
			await this.client.set(key, JSON.stringify(data));
		} catch (error) {
			console.log(error);
		}
	}

	async setSignleDataWithExpiration<T>(key: string, data: T, timeoutMS?: number) {
		if (timeoutMS === undefined) timeoutMS = 1000 * 60 * 60 * 24 * 3;
		try {
			await this.client.set(key, JSON.stringify(data), "PX", timeoutMS);
		} catch (error) {
			console.log(error);
		}
	}

	async existSingleData(key: string): Promise<boolean> {
		try {
			return (await this.client.exists(key)) > 0;
		} catch (error) {
			console.log(error);
		}
	}
}
