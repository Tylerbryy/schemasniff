import { stringify } from 'yaml';
import type { Schema } from './analyzer.js';

export async function exportSchema(schema: Schema, outputPath?: string): Promise<void> {
  const output = {
    schema: {
      url: schema.url,
      generated: schema.timestamp,
      confidence: schema.confidence,
      item_count: schema.itemCount
    },
    container: schema.containerSelector,
    fields: schema.fields.map(f => ({
      name: f.name,
      selector: f.selector,
      type: f.type,
      confidence: f.confidence,
      ...(f.sample && { sample: f.sample })
    }))
  };

  const yaml = stringify(output);

  if (outputPath) {
    await Bun.write(outputPath, yaml);
    console.error(`📝 Schema written to: ${outputPath}`);
  } else {
    console.log(yaml);
  }
}
