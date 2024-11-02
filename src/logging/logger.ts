import chalk from "chalk";
import { Logger, createLogger, format, transports } from "winston";
import * as Transport from "winston-transport";
import appConfig from "../config/config";

const logLevelColors: { [level: string]: string } = {
	debug: "#1E90FF",
	info: "#00FF00",
	warn: "#FFA500",
	error: "#FF0000",
};

export class AppLogger {
	public logger: Logger;
	public label: string;
	private debug: boolean;

	constructor(label: string, debug = false) {
		if (label.length > 30) {
			throw new Error("Too long label");
		}
		this.label = label;
		this.debug = debug;
		this.initLogger(label);
	}

	private initLogger(label: string) {
		if (this.logger) return;

		const customFormat = format.combine(
			format.timestamp({
				format: () => {
					const now = new Date();
					const month = now.toLocaleString("en-US", { month: "short" });
					const day = String(now.getDate()).padStart(2, "0");
					const time = now.toTimeString().split(" ")[0];
					return `${month} ${day} ${time}`;
				},
			}),
			this.customPrintf(),
		);
		const transportsConfig: Transport[] = [new transports.Console()];

		const logger = createLogger({
			format: customFormat,
			transports: transportsConfig,
			level: this.debug ? "debug" : "info",
		});

		this.logger = logger.child({ label });
		if (appConfig.env === "test") this.logger.pause();
	}

	private customPrintf() {
		return format.printf(({ level, message, label, timestamp, meta }) => {
			const hexColor = logLevelColors[level];
			const color = chalk.hex(hexColor);

			if ((level === "debug" && !meta) || level === "error" || level === "warn") {
				return color(`\n${level.padEnd(5)} | ${label.padEnd(10)} | ${message}`);
			}

			if (level === "debug" && meta) {
				const metaDisplay = JSON.stringify(meta, null, 2)
					.replace(/"([^"]+)":\s*"([^"]*)"/g, "$1: $2")
					.replace(/"([^"]+)":/g, "$1:");

				return color(`\n${color(level.padEnd(5))} | ${label.padEnd(10)} | ${message}, \n${metaDisplay}\n`);
			}

			return `${timestamp} | ${color(level.padEnd(5))} | ${label.padEnd(10)} | ${color(message)}`;
		});
	}
}
