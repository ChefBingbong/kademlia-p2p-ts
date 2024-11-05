import { extractError } from "./extractError";

export enum ProtocolError {
	UNKNOWN_ERROR = "UNKNOWN_ERROR",
	PARAMETER_ERROR = "PARAMETER_ERROR",
	INTERNAL_ERROR = "INTERNAL_ERROR",
	NETWORK_ERROR = "NETWORK_ERROR",
	SIGNER_ERROR = "SIGNER_ERROR",
}

/**
 * An ErrorWithCode is an Error instance with an additional `code` field.
 * Because this is a common pattern with various implementations provided
 * by libraries, checking if an Error is an ErrorWithCode should be done using
 * `isErrorWithCode(error)` instead of `error instanceof ErrorWithCode`.
 */
export class ErrorWithCode extends Error {
	public code: string;

	public static isErrorWithCode = (error: unknown): error is ErrorWithCode =>
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		error instanceof Error && typeof (error as any).code === "string";

	public static updateError = (
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		error: any,
		code: string,
		errorPrefix?: string,
	): ErrorWithCode => {
		// Check the code passed in is a RenJS error. If it isn't, it may have
		// been set by a dependency.
		if (typeof code !== "string" || code.slice(0, 6) !== "") {
			code = ProtocolError.INTERNAL_ERROR;
		}
		if (error instanceof Error) {
			(error as unknown as ErrorWithCode).code = code;
			if (errorPrefix) {
				error.message = `${errorPrefix}: ${extractError(error)}`;
			}
			return error as ErrorWithCode;
		}
		const message = extractError(error);
		return new ErrorWithCode(errorPrefix && message ? `${errorPrefix}: ${message}}` : errorPrefix || message, code);
	};

	public constructor(message: unknown, code: string, prefix?: string) {
		super(prefix ? `${prefix}: ${extractError(message)}` : extractError(message));
		this.code = code;
	}
}
