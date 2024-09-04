// biome-ignore lint/suspicious/noShadowRestrictedNames: <explanation>
export const hasOwnProperty = <T>(object: unknown, property: keyof T): object is T =>
  Object.prototype.hasOwnProperty.call(object, property);

export const invalidError = (errorMessage: string): boolean =>
  errorMessage === "" || errorMessage === "null" || errorMessage === "undefined";

// add custom error responses for any providers as new ones get added to the aggregator
export const extractError = (error: unknown): string => {
  if (error && typeof error === "object") {
    if (hasOwnProperty(error, "response") && error.response) {
      const extractedError = extractError(error.response);
      if (!invalidError(extractedError)) {
        return extractedError;
      }
    }
    if (hasOwnProperty(error, "message") && error?.message) {
      const extractedError = extractError(error?.message);
      if (!invalidError(extractedError)) {
        return extractedError;
      }
    }
    if (hasOwnProperty(error, "data") && error.data) {
      const extractedError = extractError(error.data);
      if (!invalidError(extractedError)) {
        return extractedError;
      }
    }

    if (hasOwnProperty(error, "error") && error.error) {
      const extractedError = extractError(error.error);
      if (!invalidError(extractedError)) {
        return extractedError;
      }
    }
    if (hasOwnProperty(error, "context") && error.context) {
      const extractedError = extractError(error.context);
      if (!invalidError(extractedError)) {
        return extractedError;
      }
    }
    if (hasOwnProperty(error, "statusText") && error.statusText) {
      const extractedError = extractError(error.statusText);
      if (!invalidError(extractedError)) {
        return extractedError;
      }
    }
  }
  try {
    if (typeof error === "string") {
      if (error.slice(0, 7) === "Error: ") {
        error = error.slice(7);
      }
      return String(error);
    }
    return JSON.stringify(error);
  } catch (innerError) {
    // Ignore JSON error
  }
  return String(error);
};
