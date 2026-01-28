import type { Schema, Field } from './analyzer.js';

export async function renderInteractive(schema: Schema): Promise<Schema> {
  // Simple console-based interactive review
  console.log('\n=== Schema Review ===');
  console.log(`Container: ${schema.containerSelector}`);
  console.log(`Items found: ${schema.itemCount}`);
  console.log(`Confidence: ${schema.confidence}`);
  
  console.log('\n=== Fields ===');
  schema.fields.forEach((field, idx) => {
    console.log(`${idx + 1}. ${field.name} (${field.type})`);
    console.log(`   Selector: ${field.selector}`);
    console.log(`   Confidence: ${field.confidence}`);
    if (field.sample) {
      console.log(`   Sample: ${field.sample.substring(0, 50)}${field.sample.length > 50 ? '...' : ''}`);
    }
    console.log('');
  });
  
  return schema;
}
