import { chromium, type Page, type Browser } from 'playwright';
import { getInjectableUtilityLogic } from './utils/utility-classes.js';
import { CONFIG } from './utils/constants.js';
import { AnalyzerError } from './utils/errors.js';

// ============================================================================
// Types
// ============================================================================

export interface AnalyzerOptions {
  minItems: number;
  maxDepth: number;
  fieldTypes: FieldType[];
  includeEmpty: boolean;
  enableJs: boolean;
  confidenceThreshold: number;
  /** Manual container selector override - skips automatic pattern detection */
  containerSelector?: string;
  /** Custom navigation timeout in milliseconds */
  timeout?: number;
  /** CSS selectors to exclude from pattern detection */
  excludeSelectors?: string[];
  /** Wait for this selector before analyzing */
  waitForSelector?: string;
  /** Minimum number of child elements per item */
  minChildren?: number;
  /** Minimum text length per item */
  minTextLength?: number;
  /** Prioritize table-based patterns */
  preferTable?: boolean;
  /** Auto-exclude common navigation elements */
  ignoreNav?: boolean;
  /** Custom user agent string */
  userAgent?: string;
  /** Viewport dimensions */
  viewport?: { width: number; height: number };
  /** Cookies to set before navigation */
  cookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  /** Enable debug output */
  debug?: boolean;
  /** List top N patterns instead of just the best one */
  listPatterns?: number;
}

export type FieldType = 'text' | 'href' | 'url' | 'number' | 'date' | 'price';

export interface Field {
  name: string;
  selector: string;
  type: FieldType;
  confidence: number;
  sample?: string;
}

export interface Schema {
  url: string;
  timestamp: string;
  containerSelector: string;
  fields: Field[];
  itemCount: number;
  confidence: number;
}

interface PatternSample {
  html: string;
  text: string | undefined;
  childCount: number;
  textLength: number;
}

export interface DOMPattern {
  selector: string;
  count: number;
  depth: number;
  samples: PatternSample[];
}

export interface ScoredPattern {
  pattern: DOMPattern;
  score: number;
  diversityScore: number;
  breakdown?: PatternScoreBreakdown;
}

export interface PatternScoreBreakdown {
  countScore: number;
  depthScore: number;
  diversityScore: number;
  childScore: number;
  tableBonusScore: number;
  anchorPenalty: number;
  totalScore: number;
}

/** Common navigation selectors to exclude when --ignore-nav is enabled */
const NAV_SELECTORS = [
  'nav', 'header', 'footer', '.nav', '.navbar', '.navigation',
  '.menu', '.sidebar', '.footer', '.header', '[role="navigation"]',
  '[role="banner"]', '[role="contentinfo"]'
];

// ============================================================================
// Main Entry Point
// ============================================================================

export async function analyzeUrl(url: string, options: AnalyzerOptions): Promise<Schema> {
  // Validate URL
  try {
    new URL(url);
  } catch {
    throw AnalyzerError.invalidUrl(url);
  }

  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    throw AnalyzerError.browserError(e);
  }

  const context = await browser.newContext({
    userAgent: options.userAgent,
    viewport: options.viewport,
  });

  // Set cookies if provided
  if (options.cookies && options.cookies.length > 0) {
    const parsedUrl = new URL(url);
    const cookiesWithDefaults = options.cookies.map(c => ({
      ...c,
      domain: c.domain || parsedUrl.hostname,
      path: c.path || '/',
    }));
    await context.addCookies(cookiesWithDefaults);
  }

  const page = await context.newPage();
  const timeout = options.timeout ?? CONFIG.NAVIGATION_TIMEOUT;

  try {
    const response = await page.goto(url, {
      waitUntil: options.enableJs ? 'networkidle' : 'domcontentloaded',
      timeout
    });

    if (!response?.ok()) {
      throw AnalyzerError.pageLoadFailed(response?.status(), url);
    }

    // Wait for specific selector if requested
    if (options.waitForSelector) {
      if (options.debug) {
        console.error(`⏳ Waiting for selector: ${options.waitForSelector}`);
      }
      await page.waitForSelector(options.waitForSelector, { timeout });
    }

    let bestPattern: DOMPattern | null;

    if (options.containerSelector) {
      // Manual container override - skip pattern detection
      console.error(`📦 Using manual container: ${options.containerSelector}`);
      bestPattern = await getManualPattern(page, options.containerSelector);

      if (!bestPattern) {
        throw AnalyzerError.noPatternsFound(url, 1);
      }
    } else {
      // Automatic pattern detection
      const patterns = await findRepeatedPatterns(page, options);

      // Handle --list-patterns mode
      if (options.listPatterns && options.listPatterns > 0) {
        const scoredPatterns = scorePatterns(patterns, options);
        printPatternList(scoredPatterns, options.listPatterns, options.debug ?? false);
      }

      bestPattern = selectBestPattern(patterns, options);

      if (!bestPattern) {
        throw AnalyzerError.noPatternsFound(url, options.minItems);
      }
    }

    // Infer field types for the pattern
    let fields = await inferFields(page, bestPattern, options);

    // Filter by requested field types
    if (options.fieldTypes.length > 0) {
      fields = fields.filter(f => options.fieldTypes.includes(f.type));
    }

    // Deduplicate field names
    fields = deduplicateFields(fields);

    // Calculate overall confidence
    const confidence = calculateConfidence(bestPattern, fields, options);

    const schema: Schema = {
      url,
      timestamp: new Date().toISOString(),
      containerSelector: bestPattern.selector,
      fields,
      itemCount: bestPattern.count,
      confidence
    };

    return schema;
  } catch (e) {
    if (e instanceof AnalyzerError) throw e;
    throw AnalyzerError.navigationError(url, e);
  } finally {
    await browser.close();
  }
}

// ============================================================================
// Pattern List Output
// ============================================================================

function printPatternList(patterns: ScoredPattern[], limit: number, debug: boolean): void {
  console.error(`\n📊 Top ${Math.min(limit, patterns.length)} patterns:\n`);

  patterns.slice(0, limit).forEach((sp, i) => {
    const p = sp.pattern;
    console.error(`  ${i + 1}. ${p.selector}`);
    console.error(`     Items: ${p.count} | Depth: ${p.depth} | Score: ${sp.score.toFixed(1)}`);

    if (debug && sp.breakdown) {
      const b = sp.breakdown;
      console.error(`     Breakdown: count=${b.countScore.toFixed(1)} depth=${b.depthScore.toFixed(1)} diversity=${b.diversityScore.toFixed(1)} children=${b.childScore.toFixed(1)} table=${b.tableBonusScore.toFixed(1)} anchor=${b.anchorPenalty.toFixed(1)}`);
    }

    // Show sample text
    const sampleText = p.samples[0]?.text?.substring(0, 60) || '(no text)';
    console.error(`     Sample: "${sampleText}${sampleText.length >= 60 ? '...' : ''}"`);
    console.error('');
  });
}

// ============================================================================
// Manual Container Override
// ============================================================================

async function getManualPattern(page: Page, selector: string): Promise<DOMPattern | null> {
  const pattern = await page.evaluate(
    ({ selector, maxHtmlPreview, maxTextPreview }) => {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length === 0) return null;

      function getDepth(el: Element): number {
        let depth = 0;
        let current: Element | null = el;
        while (current && current.parentElement) {
          depth++;
          current = current.parentElement;
        }
        return depth;
      }

      const samples = elements.slice(0, 5).map(el => ({
        html: el.outerHTML.substring(0, maxHtmlPreview),
        text: el.textContent?.substring(0, maxTextPreview),
        childCount: el.children.length,
        textLength: (el.textContent || '').trim().length
      }));

      return {
        selector,
        count: elements.length,
        depth: getDepth(elements[0]),
        samples
      };
    },
    {
      selector,
      maxHtmlPreview: CONFIG.MAX_HTML_PREVIEW,
      maxTextPreview: CONFIG.MAX_TEXT_PREVIEW
    }
  );

  return pattern;
}

// ============================================================================
// Pattern Detection
// ============================================================================

async function findRepeatedPatterns(page: Page, options: AnalyzerOptions): Promise<DOMPattern[]> {
  const utilityLogic = getInjectableUtilityLogic();

  // Build exclusion selectors
  let excludeSelectors = options.excludeSelectors || [];
  if (options.ignoreNav) {
    excludeSelectors = [...excludeSelectors, ...NAV_SELECTORS];
  }

  const patterns = await page.evaluate(
    ({ minItems, maxHtmlPreview, maxTextPreview, containerTags, utilityLogic, excludeSelectors, minChildren, minTextLength }) => {
      // Inject utility class detection logic
      eval(utilityLogic);

      // @ts-expect-error - getSemanticClasses is injected via eval
      const _getSemanticClasses = getSemanticClasses;

      const results: any[] = [];

      // Build a set of elements to exclude
      const excludedElements = new Set<Element>();
      excludeSelectors.forEach((sel: string) => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            excludedElements.add(el);
            // Also exclude all descendants
            el.querySelectorAll('*').forEach(desc => excludedElements.add(desc));
          });
        } catch {
          // Invalid selector, skip
        }
      });

      function isExcluded(el: Element): boolean {
        return excludedElements.has(el);
      }

      function classIntersection(classes1: string[], classes2: string[]): string[] {
        const set2 = new Set(classes2);
        return classes1.filter(cls => set2.has(cls));
      }

      function getDepth(el: Element): number {
        let depth = 0;
        let current: Element | null = el;
        while (current && current.parentElement) {
          depth++;
          current = current.parentElement;
        }
        return depth;
      }

      containerTags.forEach((tag: string) => {
        const elements = Array.from(document.querySelectorAll(tag)).filter(el => !isExcluded(el));
        if (elements.length < minItems) return;

        const groups: { classes: string[]; elements: Element[] }[] = [];

        elements.forEach(el => {
          // Filter by minChildren
          if (minChildren !== undefined && el.children.length < minChildren) return;

          // Filter by minTextLength
          if (minTextLength !== undefined) {
            const textLen = (el.textContent || '').trim().length;
            if (textLen < minTextLength) return;
          }

          const semanticClasses = _getSemanticClasses(el);
          if (semanticClasses.length === 0) return;

          let bestGroup: { classes: string[]; elements: Element[] } | null = null;
          let bestIntersection: string[] = [];

          for (const group of groups) {
            const intersection = classIntersection(semanticClasses, group.classes);
            if (intersection.length >= 1 && intersection.length > bestIntersection.length) {
              bestGroup = group;
              bestIntersection = intersection;
            }
          }

          if (bestGroup && bestIntersection.length >= 1) {
            bestGroup.classes = bestIntersection;
            bestGroup.elements.push(el);
          } else {
            groups.push({ classes: semanticClasses, elements: [el] });
          }
        });

        groups.forEach(group => {
          if (group.elements.length >= minItems && group.classes.length >= 1) {
            const selector = `${tag}.${group.classes.join('.')}`;
            // Sample more items for better diversity calculation (up to 10)
            const samples = group.elements.slice(0, 10).map(el => ({
              html: el.outerHTML.substring(0, maxHtmlPreview),
              text: el.textContent?.substring(0, maxTextPreview),
              childCount: el.children.length,
              textLength: (el.textContent || '').trim().length
            }));

            results.push({
              selector,
              count: group.elements.length,
              depth: getDepth(group.elements[0]),
              samples
            });
          }
        });
      });

      return results;
    },
    {
      minItems: options.minItems,
      maxHtmlPreview: CONFIG.MAX_HTML_PREVIEW,
      maxTextPreview: CONFIG.MAX_TEXT_PREVIEW,
      containerTags: CONFIG.CONTAINER_TAGS,
      utilityLogic,
      excludeSelectors,
      minChildren: options.minChildren,
      minTextLength: options.minTextLength
    }
  );

  return patterns;
}

// ============================================================================
// Pattern Scoring & Selection
// ============================================================================

function scorePatterns(patterns: DOMPattern[], options: AnalyzerOptions): ScoredPattern[] {
  if (patterns.length === 0) return [];

  // Filter by maxDepth
  const filtered = patterns.filter(p => p.depth <= options.maxDepth);
  if (filtered.length === 0) return [];

  const scored = filtered.map(p => {
    // Content diversity score (0-1) - calculate first
    const diversityScore = calculateDiversity(p.samples);

    // If diversity is very low (all identical content), this is likely nav/UI elements
    // Apply severe penalty that can't be overcome by count alone
    if (diversityScore < 0.2) {
      return {
        pattern: p,
        score: -100,
        diversityScore,
        breakdown: options.debug ? {
          countScore: 0,
          depthScore: 0,
          diversityScore: 0,
          childScore: 0,
          tableBonusScore: 0,
          anchorPenalty: 0,
          totalScore: -100
        } : undefined
      };
    }

    // Count score (logarithmic - more items is better)
    const countScore = Math.log(p.count) * 10;

    // Depth score (prefer moderate depth)
    const depthScore = Math.max(0, 10 - Math.abs(p.depth - CONFIG.IDEAL_DOM_DEPTH) * 2);

    // Diversity bonus (reward varied content)
    const diversityBonusScore = diversityScore * 15;

    // Child count score (prefer elements with many children - actual content containers)
    // Nav links typically have 0-2 children, content cards have 3+
    const avgChildCount = p.samples.reduce((sum, s) => sum + s.childCount, 0) / p.samples.length;
    const childScore = Math.min(avgChildCount / 3, 1) * 20;

    // Table bonus (when --prefer-table is enabled)
    let tableBonusScore = 0;
    if (options.preferTable) {
      if (p.selector.startsWith('tr.') || p.selector.startsWith('tr ')) {
        tableBonusScore = 25;
      } else if (p.selector.includes('table') || p.selector.includes('tbody')) {
        tableBonusScore = 15;
      }
    }

    // Penalize anchor tags (usually navigation, not content containers)
    let anchorPenalty = 0;
    if (p.selector.startsWith('a.')) {
      anchorPenalty = -15;
    }

    const totalScore = countScore + depthScore + diversityBonusScore + childScore + tableBonusScore + anchorPenalty;

    return {
      pattern: p,
      score: totalScore,
      diversityScore,
      breakdown: options.debug ? {
        countScore,
        depthScore,
        diversityScore: diversityBonusScore,
        childScore,
        tableBonusScore,
        anchorPenalty,
        totalScore
      } : undefined
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored;
}

function selectBestPattern(patterns: DOMPattern[], options: AnalyzerOptions): DOMPattern | null {
  const scored = scorePatterns(patterns, options);
  if (scored.length === 0) return null;

  if (options.debug) {
    const best = scored[0];
    console.error(`\n🎯 Selected pattern: ${best.pattern.selector}`);
    console.error(`   Score: ${best.score.toFixed(1)} | Items: ${best.pattern.count}`);
    if (best.breakdown) {
      const b = best.breakdown;
      console.error(`   Breakdown: count=${b.countScore.toFixed(1)} depth=${b.depthScore.toFixed(1)} diversity=${b.diversityScore.toFixed(1)} children=${b.childScore.toFixed(1)} table=${b.tableBonusScore.toFixed(1)} anchor=${b.anchorPenalty.toFixed(1)}`);
    }
    console.error('');
  }

  return scored[0].pattern;
}

/**
 * Calculate content diversity score (0-1) based on sample text uniqueness.
 * Returns 1.0 if all samples are unique, 0.0 if all samples are identical.
 */
function calculateDiversity(samples: PatternSample[]): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return 1;

  // Get text content from samples, normalized aggressively
  // - Collapse whitespace
  // - Truncate to first 50 chars (focus on primary content)
  // - Lowercase
  const texts = samples
    .map(s => (s.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 50)
      .toLowerCase()
    )
    .filter(t => t.length > 0);

  if (texts.length === 0) return 0.5; // No text content - neutral score

  const uniqueTexts = new Set(texts);
  const diversity = uniqueTexts.size / texts.length;

  return diversity;
}

// ============================================================================
// Field Inference
// ============================================================================

async function inferFields(
  page: Page,
  pattern: DOMPattern,
  options: AnalyzerOptions
): Promise<Field[]> {
  const utilityLogic = getInjectableUtilityLogic();

  const fields = await page.evaluate(
    ({ selector, includeEmpty, confidenceThreshold, sampleCount, maxFieldNameLength, utilityLogic }) => {
      // Inject utility class detection logic
      eval(utilityLogic);

      // @ts-expect-error - functions are injected via eval
      const _getSemanticClassSelector = getSemanticClassSelector;

      const containers = Array.from(document.querySelectorAll(selector));
      if (containers.length === 0) return [];

      const fieldMap = new Map<string, {
        name: string;
        type: string;
        selector: string;
        samples: string[];
      }>();

      function addToMap(key: string, name: string, type: string, el: Element, sample: string) {
        if (!fieldMap.has(key)) {
          fieldMap.set(key, {
            name,
            type,
            selector: getRelativeSelector(el, selector),
            samples: []
          });
        }
        fieldMap.get(key)!.samples.push(sample);
      }

      function getElementPath(el: Element, root: Element): string {
        const path: string[] = [];
        let current: Element | null = el;
        while (current && current !== root) {
          const tag = current.tagName.toLowerCase();
          const semClass = _getSemanticClassSelector(current);
          path.unshift(`${tag}${semClass}`);
          current = current.parentElement;
        }
        return path.join('>');
      }

      function getRelativeSelector(el: Element, containerSel: string): string {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const semClass = _getSemanticClassSelector(el);
        return `${containerSel} ${tag}${id}${semClass}`.trim();
      }

      function inferType(text: string): string {
        if (!text) return 'text';
        // Price: $99.99, £50, €100, ¥1000
        if (/^[$£€¥]\s*[\d,]+\.?\d*$/.test(text) || /^\d+\.?\d*\s*[$£€¥]$/.test(text)) {
          return 'price';
        }
        // Number
        if (/^\d+\.?\d*$/.test(text)) return 'number';
        // Date
        if (/\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}/.test(text) ||
            /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(text)) {
          return 'date';
        }
        return 'text';
      }

      function sanitizeName(text: string): string {
        return text
          .toLowerCase()
          .substring(0, maxFieldNameLength)
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
      }

      // Analyze sample containers
      containers.slice(0, sampleCount).forEach(container => {
        const walker = document.createTreeWalker(
          container,
          NodeFilter.SHOW_ELEMENT,
          null
        );

        let node: Node | null;
        while ((node = walker.nextNode())) {
          const el = node as Element;
          const tagName = el.tagName.toLowerCase();

          if (tagName === 'script' || tagName === 'style') continue;

          // Links
          if (tagName === 'a' && el.hasAttribute('href')) {
            const href = el.getAttribute('href') || '';
            const text = el.textContent?.trim() || '';
            if (text || includeEmpty) {
              const key = `link_${getElementPath(el, container)}`;
              addToMap(key, text ? sanitizeName(text) : 'link', 'href', el, href);
            }
          }

          // Images
          if (tagName === 'img' && el.hasAttribute('src')) {
            const src = el.getAttribute('src') || '';
            const alt = el.getAttribute('alt') || 'image';
            const key = `img_${getElementPath(el, container)}`;
            addToMap(key, sanitizeName(alt), 'url', el, src);
          }

          // Text content (leaf nodes only)
          if (el.children.length === 0) {
            const text = el.textContent?.trim() || '';
            if (text || includeEmpty) {
              const type = inferType(text);
              const key = `${type}_${getElementPath(el, container)}`;
              const name = text ? sanitizeName(text) : tagName;
              addToMap(key, name, type, el, text);
            }
          }
        }
      });

      // Convert to fields array with confidence filtering
      const fields: any[] = [];
      fieldMap.forEach(data => {
        const uniqueSamples = new Set(data.samples).size;
        const confidence = uniqueSamples / data.samples.length;

        if (confidence >= confidenceThreshold) {
          fields.push({
            name: data.name,
            selector: data.selector,
            type: data.type,
            confidence: Math.round(confidence * 100) / 100,
            sample: data.samples[0]
          });
        }
      });

      return fields;
    },
    {
      selector: pattern.selector,
      includeEmpty: options.includeEmpty,
      confidenceThreshold: options.confidenceThreshold,
      sampleCount: CONFIG.SAMPLE_COUNT,
      maxFieldNameLength: CONFIG.MAX_FIELD_NAME_LENGTH,
      utilityLogic
    }
  );

  return fields;
}

// ============================================================================
// Confidence Calculation
// ============================================================================

function calculateConfidence(
  pattern: DOMPattern,
  fields: Field[],
  options: AnalyzerOptions
): number {
  if (fields.length === 0) return 0;

  let score = 0;

  // Factor 1: Item count relative to minimum (30% weight)
  // Normalize: 1x minimum = 0.5, 2x+ minimum = 1.0
  const countRatio = Math.min(pattern.count / options.minItems / 2, 1);
  score += countRatio * 0.3;

  // Factor 2: Average field confidence (40% weight)
  const avgFieldConfidence = fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
  score += avgFieldConfidence * 0.4;

  // Factor 3: Number of fields detected (30% weight)
  // Having 5+ fields is considered ideal
  const fieldScore = Math.min(fields.length / 5, 1);
  score += fieldScore * 0.3;

  return Math.round(score * 100) / 100;
}

// ============================================================================
// Field Deduplication
// ============================================================================

function deduplicateFields(fields: Field[]): Field[] {
  const seen = new Map<string, number>();

  return fields.map(field => {
    const count = seen.get(field.name) || 0;
    seen.set(field.name, count + 1);

    if (count > 0) {
      return { ...field, name: `${field.name}_${count}` };
    }
    return field;
  });
}
