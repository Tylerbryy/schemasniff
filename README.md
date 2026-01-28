# schemasniff

Automatically infer scraping schemas from web pages with repeated content.

SchemaSniff analyzes a webpage's DOM to find repeated patterns (like product listings, article feeds, or table rows) and generates CSS selectors for extracting structured data.

## Installation

```bash
bun install
```

## Quick Start

```bash
# Analyze a page and output schema to stdout
bun run src/index.ts https://news.ycombinator.com

# Save schema to file
bun run src/index.ts https://books.toscrape.com -o schema.yaml

# Link globally for CLI access
bun link
schemasniff https://example.com
```

## How It Works

1. **Load** - Opens the page with Playwright (with optional JavaScript rendering)
2. **Detect** - Finds repeated DOM patterns by analyzing element classes
3. **Score** - Ranks patterns by item count, content diversity, and structure
4. **Infer** - Detects field types (text, links, prices, dates, images) from content
5. **Output** - Generates a YAML schema with CSS selectors ready for scraping

### Pattern Scoring

The tool automatically selects the best pattern using:

| Factor | Description |
|--------|-------------|
| **Item Count** | More repeated items = higher score (logarithmic) |
| **Content Diversity** | Penalizes identical content (filters nav links, buttons) |
| **Child Count** | Prefers elements with rich nested content |
| **DOM Depth** | Prefers moderate depth (not too shallow/deep) |
| **Element Type** | Penalizes anchor tags (usually navigation) |

## CLI Options

```
Usage: schemasniff [options] <url>

Arguments:
  url                         The URL of the page to analyze

Options:
  -V, --version               Output version number
  --min-items <n>             Minimum repeated items to detect (default: 3)
  --depth <n>                 Maximum DOM depth to analyze (default: 10)
  --type <types>              Field types to include, comma-separated
  --include-empty             Include empty fields in schema
  --no-js                     Disable JavaScript rendering (faster)
  --confidence <n>            Minimum confidence threshold 0-1 (default: 0.7)
  -c, --container <selector>  Manual CSS selector for item containers
  -i, --interactive           Launch interactive TUI for refinement
  -o, --output <file>         Output file path (default: stdout)
  -q, --quiet                 Suppress progress messages
  -h, --help                  Display help
```

### Option Details

#### `--min-items <n>`
Minimum number of repeated items required to detect a pattern. Increase to filter out small repeated elements (nav, footers). Decrease for pages with fewer items.

#### `--depth <n>`
Maximum DOM depth to consider. Elements deeper than this are ignored. Default (10) works for most sites.

#### `--type <types>`
Comma-separated list of field types to include. Available types:

| Type | Description | Example |
|------|-------------|---------|
| `text` | Plain text content | "Product Name" |
| `href` | Link URLs from `<a>` elements | "/products/123" |
| `url` | Image/resource URLs | "/images/photo.jpg" |
| `number` | Numeric values | "42", "3.14" |
| `date` | Date strings | "2024-01-15", "January 3" |
| `price` | Currency values | "$99.99", "£50", "€100" |

#### `--confidence <n>`
Minimum confidence threshold (0-1) for including fields. Confidence measures how consistently a field appears across sampled items. Higher = stricter (fewer fields).

#### `-c, --container <selector>`
Manually specify the CSS selector for item containers. **Skips automatic pattern detection entirely.** Use when auto-detection picks the wrong elements.

```bash
# When auto-detection picks nav links instead of listings
schemasniff https://craigslist.org/search/sss --container ".gallery-card"
```

#### `--no-js`
Disable JavaScript rendering. Uses `domcontentloaded` instead of `networkidle`. Faster for static HTML sites, but won't work for SPAs or dynamically-loaded content.

#### `-q, --quiet`
Suppress progress messages (🔍, ✅). Errors are still shown. Useful for scripting and piping output.

## Examples

### Basic Usage

```bash
# Hacker News
schemasniff https://news.ycombinator.com

# E-commerce product listings
schemasniff https://books.toscrape.com -o books-schema.yaml

# Job listings
schemasniff https://realpython.github.io/fake-jobs/ --min-items 10
```

### Filtering

```bash
# Only extract prices and links
schemasniff https://shop.example.com --type price,href

# Lower confidence for more fields
schemasniff https://example.com --confidence 0.5

# Include empty fields
schemasniff https://example.com --include-empty
```

### Performance

```bash
# Fast mode for static sites
schemasniff https://example.com --no-js

# Quiet mode for scripting
schemasniff https://example.com --quiet -o schema.yaml
```

### Manual Override

```bash
# When auto-detection fails, specify container manually
schemasniff https://craigslist.org/search/sss -c ".gallery-card"
schemasniff https://example.com -c "li.product-item"
schemasniff https://example.com -c "article.post"
```

## Output Format

```yaml
schema:
  url: https://books.toscrape.com
  generated: 2024-01-15T10:30:00.000Z
  confidence: 0.94
  item_count: 20
container: article.product_pod
fields:
  - name: a_light_in_the_attic
    selector: article.product_pod img.thumbnail
    type: url
    confidence: 1
    sample: media/cache/2c/da/2cdad67c44b002e7ead0cc35693c0e8b.jpg
  - name: a_light_in_the
    selector: article.product_pod a
    type: href
    confidence: 1
    sample: catalogue/a-light-in-the-attic_1000/index.html
  - name: 51_77
    selector: article.product_pod p.price_color
    type: price
    confidence: 1
    sample: £51.77
```

### Schema Fields

| Field | Description |
|-------|-------------|
| `schema.url` | The analyzed URL |
| `schema.generated` | Timestamp of generation |
| `schema.confidence` | Overall schema confidence (0-1) |
| `schema.item_count` | Number of items found |
| `container` | CSS selector for item containers |
| `fields[].name` | Auto-generated field name |
| `fields[].selector` | CSS selector to extract this field |
| `fields[].type` | Detected field type |
| `fields[].confidence` | Field confidence (0-1) |
| `fields[].sample` | Example value from first item |

## Troubleshooting

### "No repeated patterns found"

- Try lowering `--min-items` (default is 3)
- The page might use JavaScript - ensure `--no-js` is not set
- Use `--container` to manually specify the item selector

### Auto-detection picks navigation instead of content

This happens when nav links outnumber content items or have similar structure. Use manual override:

```bash
schemasniff https://example.com --container ".product-card"
```

### Timeout errors

- Large sites may timeout waiting for `networkidle`
- Try `--no-js` for faster loading
- The page might have infinite scroll or continuous network activity

### Too many/few fields detected

- Increase `--confidence` to be stricter (fewer fields)
- Decrease `--confidence` to be more permissive (more fields)
- Use `--type` to filter specific field types

### Fields have wrong names

Field names are auto-generated from content. Use the interactive mode to rename:

```bash
schemasniff https://example.com --interactive
```

## Architecture

```
src/
├── index.ts              # CLI entry point
├── analyzer.ts           # Core analysis logic
├── exporter.ts           # YAML output
├── ui.ts                 # Interactive TUI
└── utils/
    ├── constants.ts      # Configuration constants
    ├── errors.ts         # Custom error types
    └── utility-classes.ts # CSS utility class filtering
```

## How Pattern Detection Works

1. **Tag Scanning** - Scans common container tags (`article`, `div`, `li`, `tr`, `section`, `a`)

2. **Class Grouping** - Groups elements by shared semantic CSS classes (filters out utility classes like `flex`, `mt-4`, `text-center`)

3. **Class Intersection** - Uses set intersection to find elements sharing multiple classes

4. **Scoring** - Ranks patterns by:
   - Log of item count (more items = better)
   - Content diversity (unique text samples / total samples)
   - Average child count (rich content = better)
   - DOM depth (moderate depth preferred)

5. **Field Inference** - For the winning pattern, walks the DOM tree to find:
   - Links (`<a href>`)
   - Images (`<img src>`)
   - Text content (leaf nodes)
   - And infers types using regex patterns

## Utility Class Filtering

SchemaSniff automatically filters out utility-first CSS classes (Tailwind, Bootstrap) to find semantic patterns:

**Filtered patterns include:**
- Layout: `flex`, `grid`, `block`, `hidden`, `relative`
- Spacing: `m-4`, `p-2`, `px-[20px]`, `gap-4`
- Sizing: `w-full`, `h-screen`, `max-w-md`
- Text: `text-center`, `text-lg`, `font-bold`
- Colors: `bg-gray-100`, `text-blue-500`
- Responsive: `sm:flex`, `md:hidden`, `lg:grid-cols-3`

This ensures the tool finds meaningful selectors like `.product-card` instead of generic utility classes.

## License

MIT
