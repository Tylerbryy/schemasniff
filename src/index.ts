#!/usr/bin/env bun
import { Command } from 'commander';
import { analyzeUrl, type FieldType } from './analyzer.js';
import { AnalyzerError } from './utils/errors.js';
import { renderInteractive } from './ui.js';
import { exportSchema } from './exporter.js';

const VALID_FIELD_TYPES: FieldType[] = ['text', 'href', 'url', 'number', 'date', 'price'];

function parseFieldTypes(value: string): FieldType[] {
  const types = value.split(',').map(t => t.trim().toLowerCase());
  const invalid = types.filter(t => !VALID_FIELD_TYPES.includes(t as FieldType));

  if (invalid.length > 0) {
    console.error(`Warning: Invalid field types ignored: ${invalid.join(', ')}`);
    console.error(`Valid types: ${VALID_FIELD_TYPES.join(', ')}`);
  }

  return types.filter(t => VALID_FIELD_TYPES.includes(t as FieldType)) as FieldType[];
}

const program = new Command();

program
  .name('schemasniff')
  .description('Auto-infer scraping schemas from pages with repeated content')
  .version('0.1.0')
  .argument('<url>', 'URL to analyze')
  .option('--min-items <number>', 'Minimum repeated items to detect', '3')
  .option('--depth <number>', 'Maximum DOM depth to analyze', '10')
  .option('--type <types>', 'Field types to detect (comma-separated)', '')
  .option('--include-empty', 'Include empty fields in schema', false)
  .option('--js', 'Enable JavaScript rendering', true)
  .option('--no-js', 'Disable JavaScript rendering')
  .option('--confidence <number>', 'Minimum confidence threshold (0-1)', '0.7')
  .option('-c, --container <selector>', 'Manual container selector (skip auto-detection)')
  .option('-i, --interactive', 'Launch interactive TUI for schema refinement', false)
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .action(async (url, options) => {
    try {
      console.error('🔍 Analyzing URL:', url);

      const fieldTypes = options.type ? parseFieldTypes(options.type) : [];

      const schema = await analyzeUrl(url, {
        minItems: parseInt(options.minItems),
        maxDepth: parseInt(options.depth),
        fieldTypes,
        includeEmpty: options.includeEmpty,
        enableJs: options.js,
        confidenceThreshold: parseFloat(options.confidence),
        containerSelector: options.container
      });

      if (options.interactive) {
        const refined = await renderInteractive(schema);
        await exportSchema(refined, options.output);
      } else {
        await exportSchema(schema, options.output);
      }

      console.error('✅ Schema generated successfully');
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
