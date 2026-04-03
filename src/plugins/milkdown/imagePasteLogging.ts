/**
 * Structured logging helpers for the image paste pipeline.
 *
 * @coordinates-with imagePastePlugin.ts (consumer of all exported log functions)
 */

import { loggingService } from "../../services/loggingService";

export function logStart(file: File, documentPath: string): void {
  loggingService.logEventSync({
    level: "info",
    event: "image.paste.start",
    status: "start",
    actionId: loggingService.generateActionId(),
    context: { filename: file.name, format: file.type, sizeBytes: file.size, documentPath },
  });
}

export function logSuccess(file: File, documentPath: string, durationMs: number): void {
  loggingService.logEventSync({
    level: "info",
    event: "image.paste.success",
    status: "success",
    actionId: loggingService.generateActionId(),
    context: { filename: file.name, format: file.type, sizeBytes: file.size, documentPath },
    durationMs,
  });
}

export function logFail(file: File, documentPath: string, error: string): void {
  loggingService.logEventSync({
    level: "error",
    event: "image.paste.fail",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { filename: file.name, format: file.type, sizeBytes: file.size, documentPath },
    error,
  });
}

export function logReject(file: File, reason: string, documentPath: string): void {
  loggingService.logEventSync({
    level: "warn",
    event: "image.paste.reject",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { filename: file.name, format: file.type, sizeBytes: file.size, documentPath, reason },
  });
}

export function logBatchStart(count: number, documentPath: string): void {
  loggingService.logEventSync({
    level: "info",
    event: "image.paste.batch.start",
    status: "start",
    actionId: loggingService.generateActionId(),
    context: { count, documentPath },
  });
}

export function logBatchEnd(
  count: number,
  documentPath: string,
  successCount: number,
  failureCount: number,
  durationMs: number,
): void {
  loggingService.logEventSync({
    level: successCount > 0 ? "info" : "error",
    event: "image.paste.batch.end",
    status: failureCount === 0 ? "success" : "fail",
    actionId: loggingService.generateActionId(),
    context: { count, successCount, failureCount, documentPath },
    durationMs,
  });
}

export function logBatchFail(count: number, documentPath: string, error: string): void {
  loggingService.logEventSync({
    level: "error",
    event: "image.paste.batch.fail",
    status: "fail",
    actionId: loggingService.generateActionId(),
    context: { count, documentPath },
    error,
  });
}
