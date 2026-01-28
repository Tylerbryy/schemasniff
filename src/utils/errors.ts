/**
 * Custom error types for the schema analyzer.
 */

export type AnalyzerErrorCode =
  | 'INVALID_URL'
  | 'PAGE_LOAD_FAILED'
  | 'NAVIGATION_ERROR'
  | 'NO_PATTERNS_FOUND'
  | 'BROWSER_ERROR'
  | 'ABORTED';

export class AnalyzerError extends Error {
  constructor(
    message: string,
    public readonly code: AnalyzerErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AnalyzerError';
  }

  static invalidUrl(url: string): AnalyzerError {
    return new AnalyzerError(`Invalid URL: ${url}`, 'INVALID_URL');
  }

  static pageLoadFailed(status: number | undefined, url: string): AnalyzerError {
    return new AnalyzerError(
      `Failed to load page (status ${status ?? 'unknown'}): ${url}`,
      'PAGE_LOAD_FAILED'
    );
  }

  static navigationError(url: string, cause: unknown): AnalyzerError {
    const message = cause instanceof Error ? cause.message : String(cause);
    return new AnalyzerError(
      `Navigation failed for ${url}: ${message}`,
      'NAVIGATION_ERROR',
      cause
    );
  }

  static noPatternsFound(url: string, minItems: number): AnalyzerError {
    return new AnalyzerError(
      `No repeated patterns found with at least ${minItems} items on ${url}`,
      'NO_PATTERNS_FOUND'
    );
  }

  static browserError(cause: unknown): AnalyzerError {
    const message = cause instanceof Error ? cause.message : String(cause);
    return new AnalyzerError(
      `Browser error: ${message}`,
      'BROWSER_ERROR',
      cause
    );
  }

  static aborted(): AnalyzerError {
    return new AnalyzerError('Analysis aborted', 'ABORTED');
  }
}
