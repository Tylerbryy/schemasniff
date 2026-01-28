#!/usr/bin/env bun
import { Command } from 'commander';
import { analyzeUrl, type FieldType } from './analyzer.js';
import { AnalyzerError } from './utils/errors.js';
import { renderInteractive } from './ui.js';
import { exportSchema } from './exporter.js';

// ============================================================================
// Input Validation
// ============================================================================

const VALID_FIELD_TYPES: FieldType[] = ['text', 'href', 'url', 'number', 'date', 'price'];

function parsePositiveInt(value: string, name: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) {
    console.error(`❌ ${name} must be a positive integer, got: "${value}"`);
    process.exit(1);
  }
  return parsed;
}

function parseConfidence(value: string): number {
  const parsed = parseFloat(value);
  if (isNaN(parsed) || parsed < 0 || parsed > 1) {
    console.error(`❌ Confidence must be a number between 0 and 1, got: "${value}"`);
    process.exit(1);
  }
  return parsed;
}

function validateUrl(url: string): void {
  try {
    new URL(url);
  } catch {
    console.error(`❌ Invalid URL format: "${url}"`);
    console.error('   URL must include protocol (e.g., https://example.com)');
    process.exit(1);
  }
}

function parseFieldTypes(value: string): FieldType[] {
  const types = value.split(',').map(t => t.trim().toLowerCase());
  const invalid = types.filter(t => !VALID_FIELD_TYPES.includes(t as FieldType));

  if (invalid.length > 0) {
    console.error(`Warning: Invalid field types ignored: ${invalid.join(', ')}`);
    console.error(`Valid types: ${VALID_FIELD_TYPES.join(', ')}`);
  }

  return types.filter(t => VALID_FIELD_TYPES.includes(t as FieldType)) as FieldType[];
}

// ============================================================================
// Logging (respects --quiet flag)
// ============================================================================

let quietMode = false;

function log(message: string): void {
  if (!quietMode) {
    console.error(message);
  }
}

// ============================================================================
// Signal Handling
// ============================================================================

process.on('SIGINT', () => {
  console.error('\n⚠️  Interrupted - cleaning up...');
  process.exit(130);
});

process.on('SIGTERM', () => {
  console.error('\n⚠️  Terminated - cleaning up...');
  process.exit(143);
});

// ============================================================================
// Help Text
// ============================================================================

const DESCRIPTION = `
Automatically infer scraping schemas from web pages with repeated content.

SchemaSniff analyzes a webpage's DOM to find repeated patterns (like product
listings, article feeds, or table rows) and generates CSS selectors for
extracting structured data.

HOW IT WORKS:
  1. Loads the page with Playwright (with optional JavaScript rendering)
  2. Finds repeated DOM patterns by analyzing element classes
  3. Scores patterns by item count, content diversity, and structure
  4. Infers field types (text, links, prices, dates, images) from content
  5. Outputs a YAML schema with CSS selectors ready for scraping

FIELD TYPES:
  text    - Plain text content
  href    - Link URLs (from <a> elements)
  url     - Image/resource URLs (from <img src>, etc.)
  number  - Numeric values (integers, decimals)
  date    - Date strings (2024-01-15, "January 3", etc.)
  price   - Currency values ($99.99, £50, €100)

PATTERN SCORING:
  The tool automatically selects the best pattern using:
  - Item count (more repeated items = higher score)
  - Content diversity (penalizes identical content like nav links)
  - Child count (prefers elements with rich nested content)
  - DOM depth (prefers moderate depth, not too shallow/deep)
`.trim();

const EXAMPLES = `
EXAMPLES:

  Basic usage - analyze a page and output schema to stdout:
    $ schemasniff https://news.ycombinator.com

  Save schema to file:
    $ schemasniff https://books.toscrape.com -o schema.yaml

  Require at least 10 repeated items:
    $ schemasniff https://example.com/products --min-items 10

  Only detect prices and links:
    $ schemasniff https://shop.example.com --type price,href

  Skip JavaScript rendering (faster, for static sites):
    $ schemasniff https://example.com --no-js

  Manual container selector (when auto-detection fails):
    $ schemasniff https://craigslist.org/search/sss --container ".gallery-card"

  Lower confidence threshold (include uncertain fields):
    $ schemasniff https://example.com --confidence 0.5

  Quiet mode for scripting (no progress output):
    $ schemasniff https://example.com --quiet -o schema.yaml

EXAMPLE OUTPUT:

  schema:
    url: https://books.toscrape.com
    generated: 2024-01-15T10:30:00.000Z
    confidence: 0.94
    item_count: 20
  container: article.product_pod
  fields:
    - name: title
      selector: article.product_pod a
      type: text
      confidence: 1
      sample: "A Light in the Attic"
    - name: price
      selector: article.product_pod p.price_color
      type: price
      confidence: 1
      sample: "£51.77"

TIPS:

  - Start with defaults, then adjust --min-items if too few/many results
  - Use --container to override when auto-detection picks navigation
  - Use --no-js for faster analysis on static HTML sites
  - Use --quiet for scripting to suppress progress messages
  - Pipe to jq or yq for post-processing: schemasniff URL | yq '.fields'
`;

// ============================================================================
// CLI Definition
// ============================================================================

const program = new Command();

program
  .name('schemasniff')
  .description(DESCRIPTION)
  .version('0.1.0')
  .argument('<url>', 'The URL of the page to analyze')
  .option(
    '--min-items <n>',
    'Minimum number of repeated items required to detect a pattern.\n' +
    'Increase this to filter out small repeated elements (nav, footers).\n' +
    'Decrease for pages with fewer items.',
    '3'
  )
  .option(
    '--depth <n>',
    'Maximum DOM depth to consider for patterns.\n' +
    'Elements deeper than this are ignored.\n' +
    'Default (10) works for most sites.',
    '10'
  )
  .option(
    '--type <types>',
    'Comma-separated list of field types to include.\n' +
    'Available: text, href, url, number, date, price\n' +
    'Default: all types. Example: --type price,href',
    ''
  )
  .option(
    '--include-empty',
    'Include fields with empty values in the schema.\n' +
    'By default, empty fields are excluded.'
  )
  .option(
    '--no-js',
    'Disable JavaScript rendering (JS enabled by default).\n' +
    'Faster for static HTML sites. Uses domcontentloaded instead of networkidle.'
  )
  .option(
    '--confidence <n>',
    'Minimum confidence threshold (0-1) for including fields.\n' +
    'Higher = stricter (fewer fields). Lower = more permissive.\n' +
    'Confidence measures how consistently a field appears across items.',
    '0.7'
  )
  .option(
    '-c, --container <selector>',
    'Manually specify the CSS selector for item containers.\n' +
    'Skips automatic pattern detection entirely.\n' +
    'Use when auto-detection picks the wrong elements (e.g., nav links).\n' +
    'Example: --container "li.product-item" or --container ".gallery-card"'
  )
  .option(
    '-i, --interactive',
    'Launch interactive TUI for reviewing and refining the schema.\n' +
    'Allows you to rename fields, remove unwanted fields, etc.'
  )
  .option(
    '-o, --output <file>',
    'Output file path for the generated schema.\n' +
    'Default: stdout (prints to terminal).\n' +
    'Example: -o schema.yaml'
  )
  .option(
    '-q, --quiet',
    'Suppress progress messages (errors still shown).\n' +
    'Useful for scripting and piping output.'
  )
  .addHelpText('after', EXAMPLES)
  .action(async (url, options) => {
    // Set quiet mode first
    quietMode = options.quiet ?? false;

    // Validate URL early (fail fast)
    validateUrl(url);

    // Validate numeric options
    const minItems = parsePositiveInt(options.minItems, '--min-items');
    const maxDepth = parsePositiveInt(options.depth, '--depth');
    const confidenceThreshold = parseConfidence(options.confidence);

    try {
      log(`🔍 Analyzing URL: ${url}`);

      const fieldTypes = options.type ? parseFieldTypes(options.type) : [];

      const schema = await analyzeUrl(url, {
        minItems,
        maxDepth,
        fieldTypes,
        includeEmpty: options.includeEmpty ?? false,
        enableJs: options.js ?? true,
        confidenceThreshold,
        containerSelector: options.container
      });

      if (options.interactive) {
        const refined = await renderInteractive(schema);
        await exportSchema(refined, options.output);
      } else {
        await exportSchema(schema, options.output);
      }

      log('✅ Schema generated successfully');
    } catch (error) {
      if (error instanceof AnalyzerError) {
        console.error(`❌ [${error.code}] ${error.message}`);
      } else {
        console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    }
  });

program.parse();
