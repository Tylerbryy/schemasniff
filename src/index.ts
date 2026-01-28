#!/usr/bin/env bun
import { Command } from 'commander';
import { analyzeUrl } from './analyzer.js';
import { renderInteractive } from './ui.js';
import { exportSchema } from './exporter.js';

const program = new Command();

program
  .name('schemasniff')
  .description('Auto-infer scraping schemas from pages with repeated content')
  .version('0.1.0')
  .argument('<url>', 'URL to analyze')
  .option('--min-items <number>', 'Minimum repeated items to detect', '3')
  .option('--depth <number>', 'Maximum DOM depth to analyze', '10')
  .option('--type <types>', 'Field types to detect (comma-separated)', 'text,href,number,date,price')
  .option('--include-empty', 'Include empty fields in schema', false)
  .option('--js', 'Enable JavaScript rendering', true)
  .option('--no-js', 'Disable JavaScript rendering')
  .option('--confidence <number>', 'Minimum confidence threshold (0-1)', '0.7')
  .option('-i, --interactive', 'Launch interactive TUI for schema refinement', false)
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .action(async (url, options) => {
    try {
      console.error('🔍 Analyzing URL:', url);
      
      const schema = await analyzeUrl(url, {
        minItems: parseInt(options.minItems),
        maxDepth: parseInt(options.depth),
        fieldTypes: options.type.split(','),
        includeEmpty: options.includeEmpty,
        enableJs: options.js,
        confidenceThreshold: parseFloat(options.confidence)
      });

      if (options.interactive) {
        const refined = await renderInteractive(schema);
        await exportSchema(refined, options.output);
      } else {
        await exportSchema(schema, options.output);
      }

      console.error('✅ Schema generated successfully');
    } catch (error) {
      console.error('❌ Error:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse();
