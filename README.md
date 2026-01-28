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
| **Table Bonus** | Optional boost for `<tr>` patterns (with `--prefer-table`) |

## CLI Options

```
Usage: schemasniff [options] <url>

Arguments:
  url                          The URL of the page to analyze

Pattern Detection:
  --min-items <n>              Minimum repeated items to detect (default: 3)
  --depth <n>                  Maximum DOM depth to analyze (default: 10)
  -c, --container <selector>   Manual CSS selector for item containers
  --min-children <n>           Minimum child elements per item
  --min-text-length <n>        Minimum text length per item
  --prefer-table               Prioritize table-based patterns (<tr>)

Filtering & Exclusion:
  -e, --exclude <selectors>    Exclude CSS selectors (comma-separated)
  --ignore-nav                 Auto-exclude nav, header, footer, .menu, etc.

Field Options:
  --type <types>               Field types to include (comma-separated)
  --include-empty              Include empty fields in schema
  --confidence <n>             Minimum confidence threshold 0-1 (default: 0.7)

Browser Options:
  --no-js                      Disable JavaScript rendering (faster)
  --timeout <ms>               Navigation timeout (default: 30000)
  --wait-for <selector>        Wait for selector before analyzing
  --user-agent <string>        Custom user agent string
  --viewport <WxH>             Viewport dimensions (e.g., 1920x1080)
  --cookie <cookies>           Cookies to set (name=value,name2=value2)

Debug & Output:
  --list-patterns <n>          Show top N patterns with scores
  --debug                      Show pattern scoring breakdown
  -i, --interactive            Launch interactive TUI for refinement
  -o, --output <file>          Output file path (default: stdout)
  -q, --quiet                  Suppress progress messages
  -h, --help                   Display help
  -V, --version                Output version number
```

## Option Details

### Pattern Detection

#### `--min-items <n>`
Minimum number of repeated items required to detect a pattern. Increase to filter out small repeated elements (nav, footers). Decrease for pages with fewer items.

#### `--depth <n>`
Maximum DOM depth to consider. Elements deeper than this are ignored. Default (10) works for most sites.

#### `-c, --container <selector>`
Manually specify the CSS selector for item containers. **Skips automatic pattern detection entirely.** Use when auto-detection picks the wrong elements.

```bash
schemasniff https://craigslist.org/search/sss --container ".gallery-card"
```

#### `--min-children <n>`
Minimum number of child elements per item. Nav links typically have 0-1 children, while content cards have 3+. Use to filter out simple navigation links.

```bash
schemasniff https://example.com --min-children 3
```

#### `--min-text-length <n>`
Minimum text length (characters) per item. Filters out elements with very little content.

#### `--prefer-table`
Prioritize table-based patterns (`<table>`, `<tr>`). Useful for sites with data tables like court records, financial data, or structured listings.

```bash
schemasniff https://data-site.com --prefer-table
```

### Filtering & Exclusion

#### `-e, --exclude <selectors>`
CSS selectors to exclude from pattern detection (comma-separated). Elements matching these selectors and their descendants are ignored.

```bash
schemasniff https://example.com --exclude "nav,header,footer,.sidebar"
```

#### `--ignore-nav`
Automatically exclude common navigation elements. This excludes:
- Tags: `nav`, `header`, `footer`
- Classes: `.nav`, `.navbar`, `.navigation`, `.menu`, `.sidebar`, `.footer`, `.header`
- Roles: `[role="navigation"]`, `[role="banner"]`, `[role="contentinfo"]`

```bash
schemasniff https://example.com --ignore-nav
```

### Field Options

#### `--type <types>`
Comma-separated list of field types to include:

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

### Browser Options

#### `--no-js`
Disable JavaScript rendering. Uses `domcontentloaded` instead of `networkidle`. Faster for static HTML sites, but won't work for SPAs or dynamically-loaded content.

#### `--timeout <ms>`
Navigation timeout in milliseconds. Increase for slow-loading sites. Default: 30000 (30 seconds).

```bash
schemasniff https://slow-site.com --timeout 60000
```

#### `--wait-for <selector>`
Wait for a CSS selector to appear before analyzing. Useful for SPAs or sites with dynamically-loaded content.

```bash
schemasniff https://spa-site.com --wait-for ".product-list"
```

#### `--user-agent <string>`
Custom user agent string. Use to avoid bot detection or simulate specific browsers.

```bash
schemasniff https://example.com --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"
```

#### `--viewport <WxH>`
Viewport dimensions. Some sites render differently based on viewport size.

```bash
schemasniff https://example.com --viewport 1920x1080
```

#### `--cookie <cookies>`
Cookies to set before navigation. Format: `name=value` or `name=value;domain=.example.com`. Multiple cookies separated by commas.

```bash
schemasniff https://example.com --cookie "session=abc123,token=xyz789"
```

### Debug & Output

#### `--list-patterns <n>`
Show top N detected patterns with their scores. Helps understand what patterns are being detected and why.

```bash
schemasniff https://example.com --list-patterns 5
```

Output:
```
📊 Top 5 patterns:

  1. tr.athing.submission
     Items: 30 | Depth: 9 | Score: 69.0
     Sample: "1.AI found 12 vulnerabilities in OpenSSL (aisle.com)"

  2. tr.spacer
     Items: 30 | Depth: 9 | Score: 41.5
     Sample: "(no text)"
```

#### `--debug`
Show detailed pattern scoring breakdown. Useful for understanding why a pattern was selected.

```bash
schemasniff https://example.com --debug
```

Output:
```
🎯 Selected pattern: tr.athing.submission
   Score: 69.0 | Items: 30
   Breakdown: count=34.0 depth=0.0 diversity=15.0 children=20.0 table=0.0 anchor=0.0
```

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

### Filtering Fields

```bash
# Only extract prices and links
schemasniff https://shop.example.com --type price,href

# Lower confidence for more fields
schemasniff https://example.com --confidence 0.5

# Include empty fields
schemasniff https://example.com --include-empty
```

### Handling Navigation Issues

```bash
# Auto-exclude common nav elements
schemasniff https://example.com --ignore-nav

# Manually exclude specific selectors
schemasniff https://example.com --exclude "nav,header,.sidebar"

# Filter by minimum children (nav links have few children)
schemasniff https://example.com --min-children 3

# Combine multiple filters
schemasniff https://example.com --ignore-nav --min-children 2 --min-text-length 20
```

### Performance & Timeouts

```bash
# Fast mode for static sites
schemasniff https://example.com --no-js

# Increase timeout for slow sites
schemasniff https://slow-site.com --timeout 60000

# Wait for dynamic content
schemasniff https://spa-site.com --wait-for ".content-loaded"
```

### Data Tables & Court Sites

```bash
# Prioritize table patterns
schemasniff https://court-records.gov --prefer-table

# Combine with nav exclusion
schemasniff https://court-records.gov --prefer-table --ignore-nav

# Manual table row selector
schemasniff https://data-site.com --container "table.results tr"
```

### Debugging Pattern Selection

```bash
# See what patterns are detected
schemasniff https://example.com --list-patterns 5

# Understand scoring breakdown
schemasniff https://example.com --debug

# Combine for full debugging
schemasniff https://example.com --list-patterns 5 --debug
```

### Manual Override

```bash
# When auto-detection fails, specify container manually
schemasniff https://craigslist.org/search/sss -c ".gallery-card"
schemasniff https://example.com -c "li.product-item"
schemasniff https://example.com -c "article.post"
```

### Scripting & Automation

```bash
# Quiet mode for scripting
schemasniff https://example.com --quiet -o schema.yaml

# Pipe to yq for post-processing
schemasniff https://example.com | yq '.fields'

# Extract just selectors
schemasniff https://example.com | yq '.fields[].selector'
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
- Use `--list-patterns 10` to see if any patterns are being detected

### Auto-detection picks navigation instead of content

This happens when nav links outnumber content items or have similar structure:

```bash
# Try these in order:
schemasniff https://example.com --ignore-nav
schemasniff https://example.com --min-children 3
schemasniff https://example.com --exclude "nav,header,footer"
schemasniff https://example.com --container ".product-card"
```

### Timeout errors

```bash
# Increase timeout
schemasniff https://slow-site.com --timeout 60000

# Use faster loading mode (static sites only)
schemasniff https://example.com --no-js

# Wait for specific content instead of networkidle
schemasniff https://spa-site.com --no-js --wait-for ".content"
```

### 403 Forbidden / Bot detection

```bash
# Try a browser-like user agent
schemasniff https://example.com --user-agent "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# Set viewport to look more like a real browser
schemasniff https://example.com --viewport 1920x1080
```

### Too many/few fields detected

- Increase `--confidence` to be stricter (fewer fields)
- Decrease `--confidence` to be more permissive (more fields)
- Use `--type` to filter specific field types

### Fields have wrong names

Field names are auto-generated from content. Use the interactive mode to rename:

```bash
schemasniff https://example.com --interactive
```

### Understanding pattern selection

Use debug flags to understand why patterns are selected:

```bash
# See all detected patterns
schemasniff https://example.com --list-patterns 10

# See scoring breakdown
schemasniff https://example.com --debug

# Combine both
schemasniff https://example.com --list-patterns 5 --debug
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

2. **Exclusion Filtering** - Removes elements matching `--exclude` selectors or `--ignore-nav` patterns

3. **Class Grouping** - Groups elements by shared semantic CSS classes (filters out utility classes like `flex`, `mt-4`, `text-center`)

4. **Class Intersection** - Uses set intersection to find elements sharing multiple classes

5. **Filtering** - Applies `--min-children` and `--min-text-length` filters

6. **Scoring** - Ranks patterns by:
   - Log of item count (more items = better)
   - Content diversity (unique text samples / total samples)
   - Average child count (rich content = better)
   - DOM depth (moderate depth preferred)
   - Table bonus (if `--prefer-table` enabled)
   - Anchor penalty (for `<a>` tags)

7. **Field Inference** - For the winning pattern, walks the DOM tree to find:
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
