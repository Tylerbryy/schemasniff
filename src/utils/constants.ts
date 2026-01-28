/**
 * Configuration constants for the schema analyzer.
 */

export const CONFIG = {
  /** Number of sample items to analyze for field inference */
  SAMPLE_COUNT: 5,
  /** Maximum characters of HTML to include in pattern samples */
  MAX_HTML_PREVIEW: 200,
  /** Maximum characters of text content to include in samples */
  MAX_TEXT_PREVIEW: 100,
  /** Maximum length for auto-generated field names */
  MAX_FIELD_NAME_LENGTH: 30,
  /** Ideal DOM depth for pattern scoring (not too shallow, not too deep) */
  IDEAL_DOM_DEPTH: 4,
  /** Navigation timeout in milliseconds */
  NAVIGATION_TIMEOUT: 30000,
  /** Container tags to search for repeated patterns */
  CONTAINER_TAGS: ['article', 'div', 'li', 'tr', 'section', 'a'] as const,
} as const;

export type ContainerTag = typeof CONFIG.CONTAINER_TAGS[number];
