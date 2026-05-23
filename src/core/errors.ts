// src/core/errors.ts
// Idiomatic TypeScript custom error classes for Tidemark

import type * as z4 from 'zod/v4/core';

export class TidemarkValidationError extends Error {
  override readonly name = 'TidemarkValidationError';
  readonly attempts: number;
  readonly lastOutput: string;
  readonly zodError: z4.$ZodError | null;

  constructor(
    message: string,
    cause: { attempts: number; lastOutput: string; zodError: z4.$ZodError | null }
  ) {
    super(message);
    this.attempts = cause.attempts;
    this.lastOutput = cause.lastOutput;
    this.zodError = cause.zodError;
    // Maintains proper prototype chain in transpiled environments
    Object.setPrototypeOf(this, TidemarkValidationError.prototype);
  }
}

export class TidemarkToolLoopError extends Error {
  override readonly name = 'TidemarkToolLoopError';

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, TidemarkToolLoopError.prototype);
  }
}

export class TidemarkInputValidationError extends Error {
  override readonly name = 'TidemarkInputValidationError';
  readonly zodError: z4.$ZodError;

  constructor(message: string, zodError: z4.$ZodError) {
    super(message);
    this.zodError = zodError;
    Object.setPrototypeOf(this, TidemarkInputValidationError.prototype);
  }
}
