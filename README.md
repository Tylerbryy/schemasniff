# schemasniff

Auto-infer scraping schemas from pages with repeated content.

## Installation

```bash
bun install
bun run build
```

## Usage

```bash
# Basic usage
schemasniff https://example.com/products

# With options
schemasniff https://news.ycombinator.com \
  --min-items 5 \
  --depth 8 \
  --confidence 0.8 \
  -o schema.yaml

# Interactive mode
schemasniff https://example.com --interactive
```

## Options

- `--min-items <n>` - Minimum repeated items to detect (default: 3)
- `--depth <n>` - Maximum DOM depth to analyze (default: 10)
- `--type <types>` - Field types to detect, comma-separated (default: text,href,number,date,price)
- `--include-empty` - Include empty fields in schema
- `--js` / `--no-js` - Enable/disable JavaScript rendering (default: enabled)
- `--confidence <n>` - Minimum confidence threshold 0-1 (default: 0.7)
- `-i, --interactive` - Launch interactive TUI
- `-o, --output <file>` - Output file path

## Output Format

```yaml
schema:
  url: https://example.com
  generated: 2024-01-15T10:30:00.000Z
  confidence: 0.9
  item_count: 25
container: article.product-card
fields:
  - name: title
    selector: article.product-card h2.title
    type: text
    confidence: 0.95
  - name: price
    selector: article.product-card span.price
    type: price
    confidence: 0.98
```
