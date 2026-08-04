import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '@bothive/core';

export function errorHandler(
  error: Error & { statusCode?: number; validation?: unknown[] },
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details && { details: error.details }),
      },
    });
    return;
  }

  const statusCode = error.statusCode ?? 500;
  const message = statusCode === 500 ? 'Internal server error' : error.message;

  // Stack traces are an information leak; expose them only when explicitly
  // enabled (e.g. local development), never based on NODE_ENV defaults.
  const exposeStack = process.env.EXPOSE_ERROR_STACK === 'true';

  reply.status(statusCode).send({
    success: false,
    error: { code: 'ERROR', message },
    ...(exposeStack && error.stack && { stack: error.stack }),
  });
}
