import "dotenv/config";
import * as z from "zod";

const envsSchema = z.object({
  NODE_ENV: z.enum(["production", "development", "test"]),
  // PORT: z.string(),
});

const envVars = {
  NODE_ENV: process.env.NODE_ENV,
  // PORT: process.env.PORT,
};

try {
  const validatedEnvs = envsSchema.parse(envVars);
  console.log(validatedEnvs);
} catch (error) {
  console.error("Error validating environment variables:", error);
}

// map env vars and make it visible outside module
export default {
  env: envVars.NODE_ENV,
  // port: envVars.PORT,
};
